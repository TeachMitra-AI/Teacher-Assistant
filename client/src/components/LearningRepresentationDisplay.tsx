// AI Learning Representation System: the dispatcher. It replaced a generic plain-list/table display with a
// representation-specific view per type: custom CSS/SVG for all but graph_chart, which reuses the `recharts` dependency
// already present for AdminPage.tsx. This file stays a thin switch; the visual work lives in each ...View component.
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
