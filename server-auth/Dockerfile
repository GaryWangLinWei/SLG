# 使用官方 Node.js 20 Alpine 镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 安装编译依赖
RUN apk add --no-cache python3 make g++

# 复制 package 文件
COPY package*.json ./

# 安装所有依赖（包括 devDependencies，用于 tsc 编译）
RUN npm install

# 复制所有源代码
COPY . .

# TypeScript 编译为 JS
RUN npx tsc

# 创建运行时目录 + 复制静态文件
RUN mkdir -p ./data ./updates
COPY admin/ ./admin/

# 编译后 __dirname 指向 dist/，通过环境变量指回项目根
ENV STATIC_ROOT=/app

# 暴露端口
EXPOSE 3456

# 启动服务
CMD ["node", "dist/index.js"]
