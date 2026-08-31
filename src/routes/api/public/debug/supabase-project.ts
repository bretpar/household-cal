import { createFileRoute } from '@tanstack/react-router';

const EXPECTED_PROJECT_REF = 'rhvllchqqzeromgfukui';

export const Route = createFileRoute('/api/public/debug/supabase-project')({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env['SUPABASE_URL'];
        if (!url) {
          return Response.json({ projectRef: null, matchesExpected: false }, { status: 200 });
        }

        let projectRef: string | null = null;
        try {
          const hostname = new URL(url).hostname;
          projectRef = hostname.split('.')[0] ?? null;
        } catch {
          projectRef = null;
        }

        return Response.json({
          projectRef,
          matchesExpected: projectRef === EXPECTED_PROJECT_REF,
        });
      },
    },
  },
});
