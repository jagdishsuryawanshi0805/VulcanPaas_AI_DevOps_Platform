import { exec } from 'child_process';
import { ProjectType } from '../types';
import { deployments, appRegistry } from '../state/memory';
import { writeNginxAppConfig, reloadNginx } from './nginx';

export function buildAndDeployApp(
  repoDir: string,
  type: ProjectType,
  slug: string,
  port: number,
  deploymentId: string
): void {
  const deployment = deployments.find(d => d.id === deploymentId);
  const dockerfileName = type === 'dockerfile' ? 'Dockerfile' : 'Dockerfile.vulcan';
  const imageName = `vulcan-${slug}:latest`;
  const containerName = `vulcan-${slug}`;
  const url = `/apps/${slug}/`;

  const stopCmd = `docker stop ${containerName} 2>/dev/null || true && docker rm ${containerName} 2>/dev/null || true`;

  const buildCmd = `
    cd "${repoDir}" &&
    docker build -f ${dockerfileName} -t ${imageName} . &&
    ${stopCmd} &&
    docker run -d --name ${containerName} --restart unless-stopped -p ${port}:80 ${imageName}
  `.trim();

  exec(buildCmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`Build failed for ${slug}: ${stderr}`);
      if (deployment) deployment.status = 'failed';
      const existing = appRegistry.get(slug);
      if (existing) existing.status = 'failed';
    } else {
      console.info(`Build succeeded for ${slug} on port ${port}`);
      writeNginxAppConfig(slug, port);
      reloadNginx();

      if (deployment) {
        deployment.status = 'active';
        deployment.url = url;
        deployments.forEach(d => {
          if (d.id !== deploymentId && d.repo === deployment.repo &&
              d.branch === deployment.branch && d.status === 'active') {
            d.status = 'failed';
          }
        });
      }

      appRegistry.set(slug, {
        slug,
        repo: deployment?.repo || slug,
        branch: deployment?.branch || 'main',
        port,
        url: `http://localhost${url}`,
        projectType: type,
        deployedAt: new Date().toISOString(),
        status: 'running'
      });
    }
  });
}
