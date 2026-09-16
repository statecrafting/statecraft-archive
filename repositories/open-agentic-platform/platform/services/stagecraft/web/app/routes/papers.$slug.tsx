import { Link, useParams } from "react-router";
import { getReaderPaper } from "../lib/papers";
import { PaperReader } from "../components/paper-reader";

export function meta({ params }: { params: Record<string, string | undefined> }) {
  const paper = params.slug ? getReaderPaper(params.slug) : undefined;
  return [
    { title: paper ? `${paper.title} | OAP Papers` : "Paper | Open Agentic Platform" },
    paper
      ? { name: "description", content: paper.subtitle }
      : { name: "description", content: "Governed publication." },
  ];
}

export default function PaperRoute() {
  const { slug } = useParams();
  const paper = slug ? getReaderPaper(slug) : undefined;

  if (!paper) {
    return (
      <div className="container mx-auto max-w-6xl px-4 py-24 text-center">
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
