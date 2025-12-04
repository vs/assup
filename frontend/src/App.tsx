import { ConnectionStatus } from "@/components/ConnectionStatus";

function App() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b relative">
        <div className="container mx-auto px-4 py-0 flex items-center justify-between">
          <a href="/"><img src="/assup_logo.svg" alt="Assup" className="h-28" /></a>
          <ConnectionStatus />
        </div>
      </header>
      <main className="container mx-auto px-4 py-8">
        <p className="text-foreground">Portfolio dashboard coming soon...</p>
      </main>
    </div>
  );
}

export default App;
