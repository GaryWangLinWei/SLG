import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface Step {
  title: string;
  description: string;
  actionLabel?: string;
  actionPath?: string;
}

const STEPS: Step[] = [
  {
    title: '激活授权',
    description: '激活码绑定当前设备，到期后需要续费。在导航栏点击"续费"输入新激活码即可延长有效期。\n\n购买激活码：https://d.871faka.com/3v07Q',
  },
  {
    title: '配置模拟器',
    description: '确保模拟器已开启 ADB 调试。在模拟器配置页面输入 ADB 地址（如 127.0.0.1:5555），点击连接。\n\n连接成功后，选择对应的游戏账号。多账号可分别配置。',
    actionLabel: '去配置模拟器 →',
    actionPath: '/accounts',
  },
  {
    title: '校准坐标',
    description: '不同分辨率的模拟器需要校准建筑位置。在坐标配置页面选择当前配置，依次点击各建筑的"校准"按钮。\n\n程序会自动截图识别，按照提示操作即可完成校准。',
    actionLabel: '去校准坐标 →',
    actionPath: '/config',
  },
  {
    title: '选择功能',
    description: '在首页打开你想要运行的功能开关：采集资源、训练部队、研究科技、帮助队友等。\n\n每个功能独立运行，可随时开关。建议先只开启采集资源测试流程。',
    actionLabel: '去选择功能 →',
    actionPath: '/',
  },
  {
    title: '开始运行',
    description: '确认模拟器已打开游戏并停留在城内主界面，然后点击"开始运行"。\n\n程序会通过 OCR 识别当前界面状态，自动执行对应操作。绿色状态灯亮起表示正常运行中。',
    actionLabel: '开始使用 →',
    actionPath: '/',
  },
];

export default function TutorialPage() {
  const [step, setStep] = useState(0);
  const navigate = useNavigate();

  const isLast = step === STEPS.length - 1;
  const isFirst = step === 0;

  const handleFinish = () => {
    localStorage.setItem('tutorial-seen', 'true');
    navigate('/');
  };

  const handleSkip = () => {
    localStorage.setItem('tutorial-seen', 'true');
    navigate('/');
  };

  const handlePrev = () => {
    if (!isFirst) setStep(step - 1);
  };

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  const current = STEPS[step];

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-slate-100 flex items-center justify-center p-4">
      <div className="max-w-lg w-full">
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100 relative">

          {/* 关闭按钮 */}
          <button
            onClick={handleSkip}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
            title="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* 步骤进度条 */}
          <div className="flex justify-center gap-2 mb-8">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  i === step
                    ? 'bg-emerald-500 w-6'
                    : i < step
                    ? 'bg-emerald-300'
                    : 'bg-slate-200'
                }`}
              />
            ))}
          </div>

          {/* 内容区 */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-emerald-500 to-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
              <span className="text-2xl text-white font-bold">{step + 1}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-3">{current.title}</h2>
            <p className="text-slate-500 text-sm leading-relaxed whitespace-pre-line">
              {current.description}
            </p>
          </div>

          {/* 快捷跳转按钮 */}
          {current.actionLabel && current.actionPath && (
            <div className="mb-6 text-center">
              <button
                onClick={() => navigate(current.actionPath!)}
                className="px-6 py-2.5 bg-emerald-50 text-emerald-600 font-medium rounded-xl hover:bg-emerald-100 transition-colors text-sm"
              >
                {current.actionLabel}
              </button>
            </div>
          )}

          {/* 底部导航 */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            <button
              onClick={handlePrev}
              disabled={isFirst}
              className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← 上一步
            </button>

            <button
              onClick={handleSkip}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors"
            >
              跳过
            </button>

            <button
              onClick={handleNext}
              className="px-6 py-2 bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-600 hover:to-emerald-500 text-white font-medium rounded-xl shadow-lg hover:shadow-xl transition-all text-sm"
            >
              {isLast ? '开始使用' : '下一步 →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
