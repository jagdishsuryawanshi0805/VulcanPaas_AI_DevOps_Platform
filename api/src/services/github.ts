import axios from 'axios';
import crypto from 'crypto';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export async function syncGitHubWebhooks() {
  const token = process.env.GITHUB_TOKEN;
  const targetUrl = process.env.WEBHOOK_URL;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  
  if (!token || !targetUrl) return;

  try {
    const reposRes = await axios.get('https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });

    for (const repo of reposRes.data) {
      if (repo.fork || repo.archived) continue;

      const hooksRes = await axios.get(repo.hooks_url, {
        headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
      });
      
      const exists = hooksRes.data.some((h: any) => h.config.url === targetUrl);
      
      if (!exists) {
        await axios.post(repo.hooks_url, {
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: targetUrl,
            content_type: 'json',
            insecure_ssl: '0',
            secret: secret || ''
          }
        }, {
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
        });
        console.info(`✅ Auto-injected VulcanPaaS Webhook into repository: ${repo.full_name}`);
      }
    }
  } catch (err: any) {
    console.error(`Webhook Auto-Sync failed: ${err.message}`);
  }
}

export function verifyGitHubSignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('GITHUB_WEBHOOK_SECRET not set — skipping signature verification!');
    return true;
  }
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function cloneOrPullRepo(cloneUrl: string, repoName: string, branch: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const workspaceRoot = process.env.PROJECT_PATH || '/workspace';
    const repoDir = path.join(workspaceRoot, 'repos', repoName, branch);
    const token = process.env.GITHUB_TOKEN;
    const authenticatedUrl = token
      ? cloneUrl.replace('https://', `https://${token}@`)
      : cloneUrl;

    let cmd: string;
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      cmd = `cd "${repoDir}" && git fetch origin && git checkout ${branch} && git pull origin ${branch}`;
    } else {
      cmd = `mkdir -p "${repoDir}" && git clone --branch ${branch} --single-branch ${authenticatedUrl} "${repoDir}"`;
    }

    exec(cmd, (err, _stdout, stderr) => {
      if (err) {
        console.error(`Git clone/pull failed: ${stderr}`);
        reject(new Error(stderr));
      } else {
        console.info(`Repo ready at ${repoDir}`);
        resolve(repoDir);
      }
    });
  });
}
