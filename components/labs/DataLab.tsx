import React from 'react';
import type { Mission } from '../../types';
import { IssTracker } from './IssTracker';
import { MoonLab } from './MoonLab';
import { TransitLab } from './TransitLab';
import { HubbleLab } from './HubbleLab';
import { NumericLab } from './NumericLab';

export const DataLab: React.FC<{ mission: Mission; onResult: (text: string) => void }> = ({ mission, onResult }) => {
  const lab = mission.dataLab;
  switch (lab.kind) {
    case 'iss':
      return <IssTracker onResult={onResult} />;
    case 'moon':
      return <MoonLab onResult={onResult} />;
    case 'transit':
      return <TransitLab onResult={onResult} />;
    case 'hubble':
      return <HubbleLab onResult={onResult} />;
    case 'orbits':
    case 'scale':
      return <NumericLab title={mission.title} prompt={lab.prompt} answer={lab.answer} tolerance={lab.tolerance} unit={lab.unit} hint={lab.hint} onResult={onResult} />;
    default:
      return null;
  }
};
