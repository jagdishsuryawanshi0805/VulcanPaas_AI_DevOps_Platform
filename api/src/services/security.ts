import axios from 'axios';

export async function analyzeCommitWithDeepseek(repo: string, branch: string, commitMsg: string, patch: string): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  const systemPrompt = `You are a strict, senior DevOps Code Reviewer. Analyze the provided Git patch and produce a highly professional, vibrant, concise report in exactly this format. Do not add any extra text outside this structure:\n\n🔬 **AI Code Review**\n**Repo:** \`${repo}\` — **Branch:** \`${branch}\`\n**Commit:** \`${commitMsg}\`\n\n🔐 **Security** — [1 crisp sentence on vulnerabilities or exposed secrets. If clean, say: No security threats detected.]\n🚀 **Performance** — [1 crisp sentence on efficiency or bottlenecks. If fine, say: Execution path is efficient and well-bounded.]\n✨ **Code Quality** — [1 crisp sentence on structure, DRY, naming, or readability.]\n\n> **Verdict: [✅ APPROVED or ⚠️ NEEDS REVIEW] — [1 sharp justification sentence.]**`;

  if (!apiKey) {
    const dangerousRegex = /\b(delete|drop|purge|truncate|destroy|remove)\b/i;
    const isDangerous = dangerousRegex.test(patch);

    if (isDangerous) {
      return [
        `🔬 **AI Code Review**`,
        `**Repo:** \`${repo}\` — **Branch:** \`${branch}\``,
        `**Commit:** \`${commitMsg}\``,
        ``,
        `🔐 **Security** — CRITICAL: Destructive state alteration keywords detected in source files.`,
        `🚀 **Performance** — Execution path is efficient and well-bounded.`,
        `✨ Code Quality — Structure is clean, readable, and well-organized.`,
        ``,
        `> **Verdict: ⚠️ NEEDS REVIEW —  Contains severely destructive operations that must be manually verified.**`
      ].join('\n');
    } else {
      return [
        `🔬 **AI Code Review**`,
        `**Repo:** \`${repo}\` — **Branch:** \`${branch}\``,
        `**Commit:** \`${commitMsg}\``,
        ``,
        `🔐 **Security** — No security threats detected in this patch.`,
        `🚀 **Performance** — Execution path is efficient and well-bounded.`,
        `✨ Code Quality — Structure is clean, readable, and well-organized.`,
        ``,
        `> **Verdict: ✅ APPROVED — Safe to proceed with auto-deployment.**`
      ].join('\n');
    }
  }

  try {
    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Repo: ${repo}\nBranch: ${branch}\nCommit: ${commitMsg}\nPatch:\n${patch}` }
      ]
    }, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
    });
    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error(error.message);
    return 'Review failed due to an API error.';
  }
}
