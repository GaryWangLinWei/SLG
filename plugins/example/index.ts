import { Plugin } from '../../core/plugin';

export const ExamplePlugin: Plugin = {
  id: 'com.example.demo',
  name: '示例插件',
  version: '1.0.0',
  description: '演示如何创建插件',
  actions: [
    {
      id: 'hello-world',
      name: 'Hello World',
      description: '向世界问好',
      run: async (ctx) => {
        console.log('Hello from plugin!');
        await ctx.sleep(1);
        console.log('Done!');
      }
    }
  ]
};
