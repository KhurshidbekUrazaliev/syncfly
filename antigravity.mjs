export function migrateLegacyProvider(state) {
  for (const task of state.tasks || []) {
    if (task.provider === 'gemini') task.provider = 'antigravity';
    for (const proposed of task.plan || []) if (proposed.provider === 'gemini') proposed.provider = 'antigravity';
  }
  for (const event of state.events || []) if (event.provider === 'gemini') event.provider = 'antigravity';
  // An old Gemini CLI connection does not prove Antigravity is installed or signed in.
  state.connections = (state.connections || []).filter(id => id !== 'gemini');
  return state;
}

export function antigravityEvent(event) {
  const result = event.event === 'result' ? event.result : null;
  const step = event.step_update;
  const error = result?.error || step?.tool_info?.error?.message || event.error;
  return {
    text: result?.response || (typeof error === 'string' ? error : error ? JSON.stringify(error) : '') || step?.text_delta || step?.tool_info?.output || `[${event.event || 'event'}${step?.step_type ? ': ' + step.step_type : ''}]`,
    failed: !!(result && result.status !== 'SUCCESS'),
    complete: result?.status === 'SUCCESS',
    needsPermission: /permission|approval|soft.denied/i.test(JSON.stringify(step?.tool_info?.error || error || '')),
  };
}
