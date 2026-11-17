import './style.css';
import { QQSpeedEngine } from './game/engine';

const root = document.getElementById('app');
if (root) {
  new QQSpeedEngine(root);
}
