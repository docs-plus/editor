import { EditorApp } from "@/components/editor-app";
import { SiteIntro } from "@/components/site-intro";
import { SpikeBridge } from "@/components/spike/spike-bridge";

export default function Home() {
  return (
    <>
      <SpikeBridge />
      <EditorApp intro={<SiteIntro />} />
    </>
  );
}
