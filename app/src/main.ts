/**
 * Entry point: mount the simulator into #app and start it.
 */

import "./style.css";
import { Simulation } from "./sim/Simulation";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Missing #app container");
}

const simulation = new Simulation(container);
void simulation.init();
