/**
 * Generate new LanguageCert speaking sets with AI and save them to Supabase.
 *
 *   npm run generate:speaking-sets -- --count 5 --level B1 --publish
 *
 * Needs ANTHROPIC_API_KEY, OPENAI_API_KEY, SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in .env. Without --publish the sets are saved as
 * drafts for an admin to review in the Speaking section first.
 */
import 'dotenv/config';
import { generateSpeakingSets } from '../src/agents/speakingSetAgent';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const count = Number(arg('count') ?? 5);
  const level = (arg('level') ?? 'B1').toUpperCase();
  const publish = process.argv.includes('--publish');

  const created = await generateSpeakingSets({ count, level, publish });

  console.log(`\nCreated ${created.length} set(s):`);
  for (const set of created) {
    console.log(`  ${set.title} — ${set.theme} (${set.is_published ? 'published' : 'draft'}) ${set.id}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
