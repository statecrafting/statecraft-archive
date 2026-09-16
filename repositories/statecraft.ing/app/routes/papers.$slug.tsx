import { Link, useParams } from "react-router";
import type { Route } from "./+types/papers.$slug";
import { getReaderPaper } from "~/lib/papers";
import { PaperReader } from "~/components/paper-reader";

// The whitepaper reader route (spec 004 section 3.4). Prerendered: one static
// page per paper slug, enumerated from papers.ts in react-router.config.ts. The
// paper resolves from the bundled content module (pure), so no loader or
// runtime fetch is involved.

export function meta({ params }: Route.MetaArgs): Route.MetaDescriptors {
  const paper = params.slug ? getReaderPaper(params.slug) : undefined;
  return [
    { title: paper ? `${paper.title}: Statecraft` : "Paper: Statecraft" },
    {
      name: "description",
      content: paper ? paper.subtitle : "A governed publication.",
    },
  ];
}

export default function PaperRoute() {
  const { slug } = useParams();
  const paper = slug ? getReaderPaper(slug) : undefined;

  if (!paper) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-24 text-center">
        <h1 className="font-mono text-2xl font-bold">Paper not found</h1>
        <p className="mt-2 text-muted-foreground">
          No published paper matches that address.
        </p>
        <Link
          to="/papers"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Back to all papers
        </Link>
      </div>
    );
  }

  return <PaperReader paper={paper} />;
}
