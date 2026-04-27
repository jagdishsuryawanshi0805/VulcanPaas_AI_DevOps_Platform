import { FastifyInstance } from 'fastify';
import { deployments, appRegistry, repoRegistry } from '../state/memory';
import axios from 'axios';

export default async function chatRoutes(fastify: FastifyInstance) {
  fastify.post('/chat', async (request: any, reply: any) => {
    const { message } = request.body as any;
    if (!message) return reply.status(400).send({ error: 'Message required' });

    const allDeployments = deployments.map(d => ({
      id: d.id,
      repo: d.repo,
      branch: d.branch,
      commitHash: d.commitHash,
      message: d.message,
      status: d.status,
      date: d.date,
      url: (d as any).url || null,
      hasReview: !!d.review,
      reviewSummary: d.review ? d.review.substring(0, 400) : null
    }));

    const allApps = Array.from(appRegistry.values()).map((a: any) => ({
      slug: a.slug,
      status: a.status,
      port: a.port
    }));

    const allRepos = Array.from(repoRegistry.values()).map(r => ({
      fullName: r.fullName,
      registered: r.registered,
      lastBranch: r.lastBranch || null,
      lastDeploymentStatus: r.lastDeployment
        ? (deployments.find(d => d.id === r.lastDeployment)?.status ?? 'unknown')
        : 'never deployed'
    }));

    const failedDeployments = allDeployments.filter(d => d.status === 'failed');
    const activeApps = allApps.filter((a: any) => a.status === 'active' || a.status === 'running');
    const lastReviewedDeploy = allDeployments.find(d => d.hasReview);

    const suggestions: string[] = [];

    if (failedDeployments.length > 0) {
      suggestions.push(`Why did ${failedDeployments[0].repo.split('/')[1]} fail?`);
    }
    if (activeApps.length > 0) {
      suggestions.push('Show all running apps');
    }
    if (lastReviewedDeploy) {
      suggestions.push('What did the last code review say?');
    }
    if (allDeployments.length > 0) {
      suggestions.push('Recent deployments');
    }

    const defaultPool = [
      'System metrics',
      'Vulcan features',
      'Recent deployments',
      'Show all running apps',
      'Registered repos',
      'Code reviews',
      'Any failed deployments?',
      'What can you do?'
    ];
    for (const chip of defaultPool) {
      if (suggestions.length >= 5) break;
      if (!suggestions.includes(chip)) suggestions.push(chip);
    }
    const finalSuggestions = suggestions.slice(0, 5);

    const systemPrompt = `You are VulcanBot, the AI DevOps assistant embedded in the VulcanPaaS dashboard. Your logo is a neon infinity cloud over a glowing volcano.\n\nCurrent Date/Time: ${new Date().toISOString()}\n\n=== LIVE PLATFORM STATE ===\n\nDEPLOYMENTS (${allDeployments.length} total):\n${JSON.stringify(allDeployments, null, 2)}\n\nRUNNING APPS (${allApps.length} total):\n${JSON.stringify(allApps, null, 2)}\n\nREGISTERED REPOS (${allRepos.length} total):\n${JSON.stringify(allRepos, null, 2)}\n\n=== RULES ===\n1. Be concise, helpful, and technically accurate.\n2. Use markdown formatting with emojis where appropriate.\n3. Answer using the live data above when relevant — give specific names, statuses, commit hashes.\n4. Never make up deployment statuses or app names that are not in the data above.\n5. If asked about something not in the data, say so clearly.`;

    try {
      const apiKey = process.env.DEEPSEEK_API_KEY;
      if (!apiKey) {
        const msg = message.toLowerCase();
        let botResponse = 'I am VulcanBot. How can I help you today?';

        if (/\b(deploy|deployment|deployments|pipeline)\b/i.test(msg)) {
          botResponse = '### 🚀 Deployments\n' + (allDeployments.length
            ? '| Repo | Branch | Status |\n|------|--------|--------|\n' +
              allDeployments.slice(0, 8).map((d: any) =>
                `| **${d.repo}** | \`${d.branch}\` | ${d.status === 'active' ? '✅ Active' : d.status === 'failed' ? '❌ Failed' : '⌛ Deploying'} |`
              ).join('\n')
            : 'No deployments found yet.');
        } else if (/\b(app|apps|active|running)\b/i.test(msg)) {
          botResponse = '### 📦 Applications\n' + (allApps.length
            ? allApps.map((a: any) => `- **${a.slug}** — ${a.status}${a.port ? ` (port ${a.port})` : ''}`).join('\n')
            : 'No apps found.');
        } else if (/\b(repo|repos|repository|registered)\b/i.test(msg)) {
          botResponse = '### 📁 Registered Repos\n' + (allRepos.length
            ? allRepos.map(r => `- **${r.fullName}** — Last deploy: ${r.lastDeploymentStatus}`).join('\n')
            : 'No repos registered yet.');
        } else if (/\b(fail|failed|error|errors|bug|crash)\b/i.test(msg)) {
          botResponse = failedDeployments.length > 0
            ? `### ❌ Failed Deployments\n${failedDeployments.map(d => `- **${d.repo}** @ \`${d.branch}\` — _${d.message}_`).join('\n')}`
            : '✅ No failures detected! All deployments are healthy.';
        } else if (/\b(review|reviews|code|scan|vulnerability)\b/i.test(msg)) {
          botResponse = lastReviewedDeploy
            ? `### 🤖 Last AI Code Review\nFor **${lastReviewedDeploy.repo}** @ \`${lastReviewedDeploy.branch}\`:\n\n${lastReviewedDeploy.reviewSummary}...`
            : '### 🤖 Code Review AI\nNo reviews yet. A review runs automatically on every push!';
        } else if (/\b(metric|metrics|cpu|ram|memory|usage)\b/i.test(msg)) {
          botResponse = '### 📊 System Metrics\nReal-time metrics are tracked via **Prometheus** and visualised in **Grafana**. Check the dashboard graphs above for CPU, memory, and request rates!';
        } else if (/\b(vulcan|help|feature|features|what)\b/i.test(msg)) {
          botResponse = '### 🔥 VulcanPaaS\nYour AI-driven internal developer platform! Features:\n- **GitOps Auto-Deploy** — push to deploy\n- **AI Code Review** — logic & security scans on every commit\n- **Real-time Metrics** — Prometheus + Grafana\n- **Custom Domains** — via `vulcan.json`\n- **One-click Rollbacks**\n\nHow can I help you today?';
        }

        return { reply: botResponse, suggestions: finalSuggestions };
      }

      const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ]
      }, { headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });

      return { reply: response.data.choices[0].message.content, suggestions: finalSuggestions };
    } catch (error: any) {
      fastify.log.error(error.message);
      return reply.status(500).send({ error: 'Failed to contact AI provider' });
    }
  });
}
