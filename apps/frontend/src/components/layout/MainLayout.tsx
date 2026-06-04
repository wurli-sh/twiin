import { Outlet } from "react-router-dom";
import { Navbar } from "./Navbar";

export function MainLayout() {
  return (
    <div className="h-dvh flex flex-col bg-bg text-text">
      <Navbar />
      <main className="flex-1 min-h-0 overflow-y-auto w-full">
        <div className="h-full max-w-5xl mx-auto px-4 sm:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
