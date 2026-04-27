import fs from 'fs';
import path from 'path';
import { ProjectType, VulcanConfig } from '../types';

export function detectProjectType(dir: string): ProjectType {
  if (fs.existsSync(path.join(dir, 'Dockerfile'))) return 'dockerfile';

  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['react-scripts'] || allDeps['@craco/craco']) return 'react';
      if (allDeps['vite'] || allDeps['@vitejs/plugin-react']) return 'vite';
      return 'node';
    } catch {
      return 'node';
    }
  }

  if (fs.existsSync(path.join(dir, 'index.html'))) return 'static';
  return 'unknown';
}

export function generateDockerfile(dir: string, type: ProjectType, slug: string): boolean {
  let content = '';

  switch (type) {
    case 'react':
      content = `FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --legacy-peer-deps\nCOPY . .\nRUN PUBLIC_URL=/apps/${slug}/ npm run build\n\nFROM nginx:alpine\nCOPY --from=builder /app/build /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    case 'vite':
      content = `FROM node:18-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install\nCOPY . .\nRUN npx vite build --base=/apps/${slug}/\n\nFROM nginx:alpine\nCOPY --from=builder /app/dist /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    case 'node':
      content = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --production\nCOPY . .\nEXPOSE 3000\nCMD ["node", "index.js"]\n`;
      break;
    case 'static':
      content = `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nRUN echo 'server { listen 80; location / { root /usr/share/nginx/html; index index.html; autoindex on; } }' > /etc/nginx/conf.d/default.conf\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
      break;
    default:
      return false;
  }

  fs.writeFileSync(path.join(dir, 'Dockerfile.vulcan'), content, 'utf8');
  console.info(`Auto-generated Dockerfile.vulcan for type: ${type}`);
  return true;
}

export function readVulcanConfig(repoDir: string): VulcanConfig {
  const configPath = path.join(repoDir, 'vulcan.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.info(`vulcan.json found: ${JSON.stringify(raw)}`);
    return raw as VulcanConfig;
  } catch {
    console.warn('vulcan.json found but could not be parsed — ignoring.');
    return {};
  }
}
