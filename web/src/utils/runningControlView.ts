export type OperationState = 'idle' | 'starting' | 'stopping';

export type RunningControlAction =
  | 'connect'
  | 'retry'
  | 'loading'
  | 'starting'
  | 'stopping'
  | 'start'
  | 'stop';

interface RunningControlState {
  deviceConnected: boolean;
  intentLoaded: boolean;
  intentError: boolean;
  operationState: OperationState;
  runningIntent: boolean;
}

interface RunningControlView {
  bannerText: '状态读取中' | '启动中' | '停止中' | '运行中' | '准备就绪';
  action: RunningControlAction;
  disabled: boolean;
}

export function deriveRunningControlView(state: RunningControlState): RunningControlView {
  const bannerText = !state.intentLoaded
    ? '状态读取中'
    : state.operationState === 'starting'
      ? '启动中'
      : state.operationState === 'stopping'
        ? '停止中'
        : state.runningIntent
          ? '运行中'
          : '准备就绪';

  if (state.intentError) return { bannerText, action: 'retry', disabled: false };
  if (!state.intentLoaded) return { bannerText, action: 'loading', disabled: true };
  if (state.operationState === 'starting') return { bannerText, action: 'starting', disabled: true };
  if (state.operationState === 'stopping') return { bannerText, action: 'stopping', disabled: true };
  if (state.runningIntent) return { bannerText, action: 'stop', disabled: false };
  if (!state.deviceConnected) return { bannerText, action: 'connect', disabled: false };
  return { bannerText, action: 'start', disabled: false };
}
