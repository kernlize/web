import type { APIRoute } from 'astro';
import { absoluteUrl, href } from '../lib/site';

const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai', 'PerplexityBot', 'GoogleOther', 'Applebot-Extended', 'OAI-SearchBot', 'Bingbot'];

export const GET: APIRoute = () => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    '',
    ...AI_CRAWLERS.flatMap((agent) => [`User-agent: ${agent}`, 'Allow: /', '']),
    'Content-Signal: search=yes, ai-input=yes, ai-train=no',
    '',
    `Sitemap: ${absoluteUrl(href('sitemap-index.xml'))}`,
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
