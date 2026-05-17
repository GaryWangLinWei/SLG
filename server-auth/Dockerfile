# 使用官方 Node.js 20 Alpine 镜像
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# 安装编译依赖
RUN apk add --no-cache python3 make g++

# 复制 package 文件
COPY package*.json ./

# 安装所有依赖（包括 devDependencies）
RUN npm install

# 复制所有源代码
COPY . .

# 创建数据目录
RUN mkdir -p ./data

# 暴露端口
EXPOSE 3456

# 启动服务 - 跳过类型检查
CMD ["npx", "ts-node", "--transpile-only", "index.ts"]
