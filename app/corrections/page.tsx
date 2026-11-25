import type { Metadata } from "next";
import { PolicyLayout, CorrectionsContent } from "@/components/open-order/LaunchNotice";

export const metadata: Metadata = { title: "Corrections | Open Order", description: "Report a source, interpretation, technical or privacy concern safely." };

export default function Page() {
  return <PolicyLayout title={"Corrections"}><CorrectionsContent /></PolicyLayout>;
}
