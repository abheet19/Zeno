/**
 * Mesh: this machine's device identity, who it trusts, and a pairing that has
 * no second end yet.
 *
 * THE HONEST PART, stated once here because every route below depends on it:
 * the protocol core is built and the other end is not. Pairing, sealed
 * envelopes and the convergent log are tested against a SIMULATED second
 * device; the phone client that would be the real one does not exist, and no
 * transport carries bytes to it either. So this daemon can start a pairing —
 * mint a real invite, show a real short code — and it can never finish one.
 * These routes say that plainly rather than serving an empty device list that
 * reads like a phone that dropped off.
 */
import { hostname } from 'node:os';
import type { ServerResponse } from 'node:http';
import { acceptPairing, beginPairing, completePairing, createIdentity, type Identity } from '@abheet19/zeno-mesh';
import type { Role } from '../tokens.js';
import type { MeshPairing, ServerCtx } from '../server/context.js';
import { json, otherCode } from './http.js';
import { lanIps } from './state.js';

/**
 * Who this machine is on the mesh. The identity is minted LAZILY, on the
 * first mesh request, and lives only in memory: `Identity.privateKey` is a
 * KeyObject the mesh package deliberately never exports, serializes or logs,
 * so there is nothing to write to disk without breaking that rule. The
 * consequence is real and the window says it out loud: this machine's device
 * id changes every time the daemon restarts.
 */
export function meshIdentity(ctx: ServerCtx): Identity {
  if (ctx.mesh.self === null) {
    ctx.mesh.self = createIdentity();
    ctx.mesh.since = new Date().toISOString();
  }
  return ctx.mesh.self;
}

/** The transmittable half of a pairing, plus why it cannot be completed. */
function pairingView(p: MeshPairing): Record<string, unknown> {
  return {
    // What a second device would receive over the wire. The transfer format
    // (QR, deep link, typed) is deliberately NOT invented here: there is no
    // phone client to agree with, and guessing one would be fiction.
    invite: {
      deviceId: p.offer.invite.deviceId,
      publicKey: p.offer.invite.publicKey.toString('hex'),
    },
    // The code the owner reads aloud. Real, from the mesh package's CSPRNG.
    code: p.offer.code,
    startedAt: p.startedAt,
    completable: false,
    blockedBy:
      'The Zeno phone client is not built, so no second device can answer this invite. ' +
      'The invite and the code are real and this pairing is genuinely open — it will simply ' +
      'stay open until you cancel it.',
  };
}

/**
 * Who this machine is on the mesh, who it is paired with, and what is missing.
 *
 * Readable by either role: knowing which devices exist is not pairing with
 * one, the same line /work draws. `paired` comes from the real TrustStore.
 */
export function serveMeshDevices(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  const self = meshIdentity(ctx);
  // Safe-mode LAN phone access. lanAccess is legible to either role; the URLs
  // carry the launch nonce (the owner secret), so they are owner-only.
  const lanOn = ctx.opts.lanAccess === true;
  const phoneUrls = (lanOn && role === 'owner' && ctx.opts.launchNonce !== undefined && ctx.opts.port !== undefined)
    ? lanIps().map((ip) => `http://${ip}:${ctx.opts.port}/?k=${ctx.opts.launchNonce}`)
    : [];
  json(res, 200, {
    thisDevice: {
      label: 'This PC',
      host: hostname(),
      deviceId: self.deviceId,
      publicKey: self.publicKey.toString('hex'),
      since: ctx.mesh.since,
      // Said out loud because it changes what the owner sees after a restart.
      identityPersisted: false,
    },
    paired: ctx.meshTrust.devices(),
    pairing: ctx.mesh.pairing === null ? null : pairingView(ctx.mesh.pairing),
    phoneClient: {
      built: false,
      note:
        'The Zeno phone client is not built. No second device can complete a pairing yet — ' +
        'there is nothing on the other end to receive an invite or send one back.',
    },
    // Safe-mode LAN: not a paired device, just this same daemon reachable from a
    // phone on the network. Off unless the owner started with ZENO_LAN=1.
    phoneAccess: { lanAccess: lanOn, urls: phoneUrls },
  });
}

/**
 * Start a pairing: mint the invite this machine would transmit and the short
 * code it shows for the owner to carry by hand. Owner-only — trusting a new
 * device is the owner's call, the same way starting an agent is.
 */
export function postMeshPairing(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can start a pairing.',
        resolve: 'Start it from the Zeno window.',
      },
    });
  }
  // A second Start would silently replace a code the owner may already have
  // read out loud, which is exactly the confusion the code exists to prevent.
  if (ctx.mesh.pairing !== null) {
    return json(res, 409, {
      error: {
        code: 'pairing-in-progress',
        message: 'A pairing is already open, showing a code that may already have been read out.',
        resolve: 'Use the code that is showing, or cancel it (POST /mesh/pairing/cancel) and start again.',
      },
    });
  }
  ctx.mesh.pairing = { offer: beginPairing(meshIdentity(ctx)), startedAt: new Date().toISOString() };
  json(res, 200, { pairing: pairingView(ctx.mesh.pairing) });
}

/** Forget the open pairing and its code. Cancelling nothing is not an error. */
export function postMeshPairingCancel(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can cancel a pairing.',
        resolve: 'Cancel it from the Zeno window.',
      },
    });
  }
  const cancelled = ctx.mesh.pairing !== null;
  ctx.mesh.pairing = null;
  json(res, 200, { cancelled, pairing: null });
}

/**
 * Run the real handshake against a peer simulated INSIDE this process, and
 * report what both sides derived.
 *
 * This is the one honest way to show the protocol works while the other end
 * does not exist. It proves the two claims that matter: both sides derive the
 * SAME verification string from opposite viewpoints, and a peer given the
 * WRONG code derives a different one — the silent, total failure that stops a
 * mistyped or intercepted code from becoming a working session.
 *
 * The simulated peer is ephemeral and is discarded when this function returns.
 * It is NOT remembered in the trust store, so it can never appear as a device.
 */
export function postMeshSelfCheck(ctx: ServerCtx, res: ServerResponse, role: Role): void {
  if (role !== 'owner') {
    return json(res, 403, {
      error: {
        code: 'owner-only',
        message: 'Only the owner can run the mesh self-check.',
        resolve: 'Run it from the Zeno window.',
      },
    });
  }
  const self = meshIdentity(ctx);
  const peer = createIdentity(); // simulated, ephemeral, never stored
  const offer = beginPairing(self);
  const accepted = acceptPairing(peer, offer.invite, offer.code);
  const completed = completePairing(self, accepted.response, offer.code);
  const mistyped = acceptPairing(peer, offer.invite, otherCode(offer.code));
  json(res, 200, {
    selfCheck: {
      simulatedPeer: true,
      paired: false,
      sas: completed.session.sas,
      sasMatch: completed.session.sas === accepted.session.sas,
      wrongCodeDiverges: mistyped.session.sas !== accepted.session.sas,
      localDeviceId: self.deviceId,
      simulatedPeerDeviceId: peer.deviceId,
      note:
        'This ran the real pairing handshake between this machine and a second device simulated ' +
        'inside the daemon. Both sides derived the same verification code, and a peer given the ' +
        'wrong code derived a different one — which is the failure the protocol is designed to ' +
        'have. The simulated peer was discarded: nothing was paired, nothing was stored, and no ' +
        'device was added.',
    },
  });
}
