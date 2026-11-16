import { EditorApp } from "@/components/editor-app";
import { SiteIntro, SiteJsonLd } from "@/components/site-intro";

export default function Home() {
  return (
    <>
      <SiteJsonLd />
      <EditorApp intro={<SiteIntro />} />
    </>
  );
}
