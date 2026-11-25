import type { Metadata } from "next";
import { PolicyLayout, PrivacyContent } from "@/components/open-order/LaunchNotice";

export const metadata: Metadata = { title: "Privacy | Open Order", description: "How Open Order processes information and the limits of confidentiality." };

export default function Page() {
  return <PolicyLayout title={"Privacy"}><PrivacyContent /></PolicyLayout>;
}
