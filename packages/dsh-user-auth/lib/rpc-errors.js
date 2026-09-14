/** Access policy reasons live in details; wire codes must follow DSH's RPC union. */
export function accessDenied(request, reason, message) {
  return {rpcId: request?.rpcId, result: {ok: false, error: {
    code: 'bad-request', message,
    details: {issues: [{code: 'custom', path: ['payload'], message, reason}]},
  }}};
}
