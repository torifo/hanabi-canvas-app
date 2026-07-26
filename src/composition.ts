import { SoundEngine } from './audio/SoundEngine';
import { GraphicsEngine } from './graphics/GraphicsEngine';
import { HanabiSchedule } from './realtime/HanabiSchedule';
import { PresenceClient } from './realtime/PresenceClient';
import { MessageStore } from './messages/MessageStore';
import { ComposeOverlay } from './ui/ComposeOverlay';
import { IntroOverlay as IntroOverlayImpl } from './ui/IntroOverlay';
import { UIController as UIControllerImpl } from './ui/UIController';
import type {
  GraphicsEngine as GraphicsEngineContract,
  HanabiSchedule as HanabiScheduleContract,
  IntroOverlay,
  PresenceClient as PresenceClientContract,
  SoundEngine as SoundEngineContract,
  UIController
} from './types';

export interface AppDependencies {
  graphics: GraphicsEngineContract;
  sound: SoundEngineContract;
  presence: PresenceClientContract;
  schedule: HanabiScheduleContract;
  intro: IntroOverlay;
  ui: UIController;
  compose: ComposeOverlay;
  messages: MessageStore;
}

export function createDependencies(): AppDependencies {
  return {
    graphics: new GraphicsEngine(),
    sound: new SoundEngine(),
    presence: new PresenceClient(),
    schedule: new HanabiSchedule(),
    intro: new IntroOverlayImpl(),
    ui: new UIControllerImpl(),
    compose: new ComposeOverlay(),
    messages: new MessageStore()
  };
}
