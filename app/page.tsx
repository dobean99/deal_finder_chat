import { Chat } from "@/components/Chat";
import { BANNER_CAMPAIGNS } from "@/lib/config";

export default function Home() {
  // Server-side: only expose slug+name to the client; tiles whose affiliate
  // URL env var is unset are dropped (their /go/b route 404s anyway).
  const banners = BANNER_CAMPAIGNS.filter((b) => process.env[b.envVar]).map(
    ({ slug, name }) => ({ slug, name }),
  );
  return <Chat banners={banners} />;
}
