import type { Metadata } from "next";
import { PolicyLayout, SourcesContent } from "@/components/open-order/LaunchNotice";

export const metadata: Metadata = { title: "Sources | Open Order", description: "Indexed editions, source currency and parliamentary attribution." };

export default function Page() {
  return <PolicyLayout title={"Sources"}><SourcesContent /></PolicyLayout>;
}
