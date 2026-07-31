import { redirect } from "next/navigation";

import { getInstallStatus } from "@/lib/server/install-status";
import HomeClient from "./home-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
    if (!(await getInstallStatus()).ready) redirect("/install");
    return <HomeClient />;
}
