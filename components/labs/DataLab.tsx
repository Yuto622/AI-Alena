import React from 'react';
import type { ClassroomLocation, Mission } from '../../types';
import { IssTracker } from './IssTracker';
import { MoonLab } from './MoonLab';
import { TransitLab } from './TransitLab';
import { HubbleLab } from './HubbleLab';
import { NumericLab } from './NumericLab';
import { SkyAboveSchool } from './SkyAboveSchool';

export const DataLab: React.FC<{ mission: Mission; onResult: (text: string) => void; location?: ClassroomLocation | null }> = ({ mission, onResult, location }) => {
  const lab = mission.dataLab;
  switch (lab.kind) {
    case 'iss':
      return (
        <div className="space-y-4">
          <IssTracker onResult={onResult} />
          {/* 教室の住所が登録されていれば「御校の上空」をそのまま教材に */}
          <SkyAboveSchool location={location || undefined} allowInput={!location} compact />
        </div>
      );
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
