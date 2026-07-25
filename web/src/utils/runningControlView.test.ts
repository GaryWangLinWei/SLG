import { deriveRunningControlView } from './runningControlView';

const base = {
  deviceConnected: true,
  intentLoaded: true,
  intentError: false,
  operationState: 'idle' as const,
  runningIntent: false,
};

describe('deriveRunningControlView', () => {
  test.each([
    [{ ...base, intentLoaded: false }, '状态读取中'],
    [{ ...base, operationState: 'starting' as const }, '启动中'],
    [{ ...base, operationState: 'stopping' as const }, '停止中'],
    [{ ...base, runningIntent: true }, '运行中'],
    [base, '准备就绪'],
  ])('derives banner text from session state %#', (input, bannerText) => {
    expect(deriveRunningControlView(input).bannerText).toBe(bannerText);
  });

  test.each([
    [{ ...base, deviceConnected: false, intentError: true }, { action: 'connect', disabled: false }],
    [{ ...base, intentError: true }, { action: 'retry', disabled: false }],
    [{ ...base, intentLoaded: false }, { action: 'loading', disabled: true }],
    [{ ...base, operationState: 'starting' as const }, { action: 'starting', disabled: true }],
    [{ ...base, operationState: 'stopping' as const }, { action: 'stopping', disabled: true }],
    [base, { action: 'start', disabled: false }],
    [{ ...base, runningIntent: true }, { action: 'stop', disabled: false }],
  ])('derives action by required priority %#', (input, expected) => {
    const view = deriveRunningControlView(input);
    expect({ action: view.action, disabled: view.disabled }).toEqual(expected);
  });
});
