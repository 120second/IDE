import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
import "./workbench.css";

const target = document.getElementById("app");

if (!target) {
  throw new Error("找不到 LightCP 挂载元素");
}

mount(App, { target });
