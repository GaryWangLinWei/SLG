import { PluginContext } from '../../../core/plugin';
import { RokConfig } from '../index';

export async function sendWorldChat(
  ctx: PluginContext,
  config: RokConfig,
  message: string
): Promise<void> {
  const wc = config.worldChat;

  // 点击输入框
  ctx.log(`  点击输入框 (${wc.inputBox.x}, ${wc.inputBox.y})`);
  await ctx.tap(wc.inputBox.x, wc.inputBox.y);
  await ctx.sleep(0.5);

  // 通过 ADB input text 输入消息
  ctx.log(`  输入消息: ${message}`);
  await ctx.inputText(message);
  await ctx.sleep(0.3);

  // 点击发送
  ctx.log(`  点击发送 (${wc.sendButton.x}, ${wc.sendButton.y})`);
  await ctx.tap(wc.sendButton.x, wc.sendButton.y);
  await ctx.sleep(0.5);
}

export async function sendWorldChatFirstRun(
  ctx: PluginContext,
  config: RokConfig,
  message: string
): Promise<void> {
  const wc = config.worldChat;

  // 点击聊天区域打开聊天面板
  ctx.log(`  打开聊天面板 (${wc.chatButton.x}, ${wc.chatButton.y})`);
  await ctx.tap(wc.chatButton.x, wc.chatButton.y);
  await ctx.sleep(1);

  // 后续与正常发送一致
  await sendWorldChat(ctx, config, message);
}
