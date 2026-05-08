import { AdbDevice } from '../core/device';
import { Vision } from '../core/vision';
import { PluginManager } from '../core/plugin';
import { SlgCommonPlugin } from '../plugins';

async function main() {
  console.log('========================================');
  console.log('   SLG 自动化框架 v1.0');
  console.log('========================================');
  console.log();

  const device = new AdbDevice();
  console.log('[系统] 正在连接Android设备...');
  const connected = await device.connect();

  if (!connected) {
    console.log('[错误] 未找到设备，请连接Android设备或启动模拟器');
    console.log('[提示] 请确保ADB已配置，设备已开启开发者选项和USB调试');
    process.exit(1);
  }

  console.log('[系统] 设备连接成功！');
  console.log();

  const vision = new Vision();
  const pluginManager = new PluginManager(device, vision);

  console.log('[系统] 加载插件...');
  pluginManager.register(SlgCommonPlugin);
  console.log(`[系统] 已加载插件: ${pluginManager.listPlugins().map(p => `${p.name} v${p.version}`).join(', ')}`);
  console.log();

  console.log('可用操作:');
  SlgCommonPlugin.actions.forEach(action => {
    console.log(`  - ${action.name}: ${action.description}`);
  });
  console.log();

  console.log('[提示] 可以通过修改配置来定义具体游戏的建筑位置和资源位置');
  console.log('[提示] 下一步将添加Web管理界面来配置和运行这些操作');
  console.log();
  console.log('Phase 2 完成！SLG通用插件已就绪。');
}

main().catch(console.error);
