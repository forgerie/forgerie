import { createRoot } from "react-dom/client";
import { ForgerieSession } from "./ForgerieSession";
import "./ui/theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing app root.");
const id = new URLSearchParams(window.location.search).get("session")?.trim();
createRoot(root).render(id ? <ForgerieSession key={id} id={id} /> :
  <main className="setup"><h1>Open a Pi session</h1>
    <p>Add an existing session ID to this URL.</p><code>?session=&lt;id&gt;</code>
    <p>Find the ID in Forgerie. This MVP does not create sessions.</p>
  </main>);
