import type { Metadata } from "next";
import { PolicyLayout, AboutContent } from "@/components/open-order/LaunchNotice";

export const metadata: Metadata = { title: "About Open Order | Open Order", description: "Independent experimental parliamentary procedural guidance." };

export default function Page() {
  return <PolicyLayout title={"About Open Order"}><AboutContent /></PolicyLayout>;
}
