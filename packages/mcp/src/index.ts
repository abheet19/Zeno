/**
 * Zeno · MCP — the model-facing edge. Public surface.
 *
 * An MCP client connects over stdio and sees tools that let it PROPOSE and READ,
 * never act. The two halves are a pure JSON-RPC line codec (`rpc.ts`) and a pure
 * method set over an injected Kernel + work source (`server.ts`); `main.ts` is
 * the only place that touches a stream. There is no approve tool, by design.
 */
export {
  JSONRPC_VERSION,
  RpcError,
  dispatch,
  failure,
  isNotification,
  parse,
  success,
  PARSE_ERROR,
  INVALID_REQUEST,
  METHOD_NOT_FOUND,
  INVALID_PARAMS,
  INTERNAL_ERROR,
  type Handler,
  type Handlers,
  type JsonRpcFailure,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
  type ParseResult,
} from './rpc.js';
export {
  PROTOCOL_VERSION,
  SERVER_INFO,
  SERVER_INSTRUCTIONS,
  TOOLS,
  mcpHandlers,
  type McpServerOptions,
  type WorkItem,
  type WorkSource,
} from './server.js';
