// AI Learning Representation System (ADR Phase D2) — dispatcher.
//
// Phase D1 shipped one generic display (plain lists/tables) covering all
// six types identically, deliberately, as the "smaller first slice". D2
// replaces that with a representation-specific view per type, per the
// approved D2 scope: custom CSS/SVG for everything except graph_chart,
// which reuses the `recharts` dependency already present for AdminPage.tsx.
// This file itself stays a thin switch — the actual visual work lives in
// each ...View component.
import ComparisonTableView from './ComparisonTableView';
import GraphChartView from './GraphChartView';
import HierarchyTreeView from './HierarchyTreeView';
import LabeledPartsView from './LabeledPartsView';
import ProcessDiagramView from './ProcessDiagramView';
import TimelineView from './TimelineView';
import type {
  ComparisonTableData,
  GraphChartData,
  HierarchyDiagramData,
  LabeledDiagramData,
  LearningRepresentationData,
  LearningRepresentationType,
  ProcessDiagramData,
  TimelineData,
} from '../types';

interface DisplayProps {
  representation: LearningRepresentationType;
  data: LearningRepresentationData;
}

export default function LearningRepresentationDisplay({ representation, data }: DisplayProps) {
  switch (representation) {
    case 'process_diagram':
      return <ProcessDiagramView data={data as ProcessDiagramData} />;
    case 'comparison_table':
      return <ComparisonTableView data={data as ComparisonTableData} />;
    case 'timeline':
      return <TimelineView data={data as TimelineData} />;
    case 'hierarchy_diagram':
      return <HierarchyTreeView data={data as HierarchyDiagramData} />;
    case 'labeled_diagram':
      return <LabeledPartsView data={data as LabeledDiagramData} />;
    case 'graph_chart':
      return <GraphChartView data={data as GraphChartData} />;
    case 'verbal_explanation':
    default:
      return null;
  }
}
