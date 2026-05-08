import { AdbDevice } from '../core/device';
import { Vision } from '../core/vision';
import { PluginManager } from '../core/plugin';
import { ExamplePlugin } from '../plugins/example';

async function main() {
  console.log('SLG Auto Framework starting...');

  const device = new AdbDevice();
  const connected = await device.connect();

  if (!connected) {
    console.log('No device found. Please connect an Android device/emulator.');
    process.exit(1);
  }

  console.log('Device connected successfully!');

  const vision = new Vision();
  const pluginManager = new PluginManager(device, vision);

  pluginManager.register(ExamplePlugin);
  console.log('Registered plugins:', pluginManager.listPlugins().map(p => p.name));

  console.log('Running example action...');
  await pluginManager.runAction('com.example.demo', 'hello-world');

  console.log('Done!');
}

main().catch(console.error);
