/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

/*
 * Table for displaying annotations. This is mostly a copy of the forecasts table.
 * This version supports both fetching the annotations by itself (used in the jobs list) and
 * getting the annotations via props (used in Anomaly Explorer and Single Series Viewer).
 */

import _ from 'lodash';
import PropTypes from 'prop-types';
import rison from 'rison-node';

import React, {
  Component
} from 'react';

import {
  EuiBadge,
  EuiButtonIcon,
  EuiCallOut,
  EuiFlexGroup,
  EuiFlexItem,
  EuiInMemoryTable,
  EuiLink,
  EuiLoadingSpinner,
  EuiToolTip,
} from '@elastic/eui';

import {
  RIGHT_ALIGNMENT,
} from '@elastic/eui/lib/services';

import { formatDate } from '@elastic/eui/lib/services/format';
import chrome from 'ui/chrome';

import { addItemToRecentlyAccessed } from '../../util/recently_accessed';
import { ml } from '../../services/ml_api_service';
import { mlJobService } from '../../services/job_service';
import { mlTableService } from '../../services/table_service';
import { ANNOTATIONS_TABLE_DEFAULT_QUERY_SIZE } from '../../../common/constants/search';
import { isTimeSeriesViewJob } from '../../../common/util/job_utils';


const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * Table component for rendering the lists of annotations for an ML job.
 */
class AnnotationsTable extends Component {
  constructor(props) {
    super(props);
    this.state = {
      annotations: [],
      isLoading: false,
      // Need to do a detailed check here because the angular wrapper could pass on something like `[undefined]`.
      jobId: (Array.isArray(this.props.jobs) && this.props.jobs.length > 0 && this.props.jobs[0] !== undefined)
        ? this.props.jobs[0].job_id : undefined,
    };
  }

  getAnnotations() {
    const job = this.props.jobs[0];
    const dataCounts = job.data_counts;

    this.setState({
      isLoading: true
    });

    if (dataCounts.processed_record_count > 0) {
      // Load annotations for the selected job.
      ml.annotations.getAnnotations({
        jobIds: [job.job_id],
        earliestMs: null,
        latestMs: null,
        maxAnnotations: ANNOTATIONS_TABLE_DEFAULT_QUERY_SIZE
      }).then((resp) => {
        this.setState((prevState, props) => ({
          annotations: resp.annotations[props.jobs[0].job_id] || [],
          errorMessage: undefined,
          isLoading: false,
          jobId: props.jobs[0].job_id
        }));
      }).catch((resp) => {
        console.log('Error loading list of annotations for jobs list:', resp);
        this.setState({
          annotations: [],
          errorMessage: 'Error loading the list of annotations for this job',
          isLoading: false,
          jobId: undefined
        });
      });
    }
  }

  getJob(jobId) {
    // check if the job was supplied via props and matches the supplied jobId
    if (Array.isArray(this.props.jobs) && this.props.jobs.length > 0) {
      const job = this.props.jobs[0];
      if (jobId === undefined || job.job_id === jobId) {
        return job;
      }
    }

    return mlJobService.getJob(jobId);
  }

  componentDidMount() {
    if (this.props.annotations === undefined) {
      this.getAnnotations();
    }
  }

  componentWillUpdate() {
    if (
      this.props.annotations === undefined &&
      this.state.isLoading === false &&
      this.state.jobId !== this.props.jobs[0].job_id
    ) {
      this.getAnnotations();
    }
  }

  openSingleMetricView = (annotation = {}) => {
    // Creates the link to the Single Metric Viewer.
    // Set the total time range from the start to the end of the annotation.
    const job = this.getJob(annotation.job_id);
    const dataCounts = job.data_counts;
    const from = new Date(dataCounts.earliest_record_timestamp).toISOString();
    const to = new Date(dataCounts.latest_record_timestamp).toISOString();

    const globalSettings = {
      ml: {
        jobIds: [job.job_id]
      },
      refreshInterval: {
        display: 'Off',
        pause: false,
        value: 0
      },
      time: {
        from,
        to,
        mode: 'absolute'
      }
    };

    const appState = {
      filters: [],
      query: {
        query_string: {
          analyze_wildcard: true,
          query: '*'
        }
      }
    };

    if (annotation.timestamp !== undefined && annotation.end_timestamp !== undefined) {
      appState.mlTimeSeriesExplorer = {
        zoom: {
          from: new Date(annotation.timestamp).toISOString(),
          to: new Date(annotation.end_timestamp).toISOString()
        }
      };

      if (annotation.timestamp < dataCounts.earliest_record_timestamp) {
        globalSettings.time.from = new Date(annotation.timestamp).toISOString();
      }

      if (annotation.end_timestamp > dataCounts.latest_record_timestamp) {
        globalSettings.time.to = new Date(annotation.end_timestamp).toISOString();
      }
    }

    const _g = rison.encode(globalSettings);
    const _a = rison.encode(appState);

    const url = `?_g=${_g}&_a=${_a}`;
    addItemToRecentlyAccessed('timeseriesexplorer', job.job_id, url);
    window.open(`${chrome.getBasePath()}/app/ml#/timeseriesexplorer${url}`, '_self');
  }

  onMouseOverRow = (record) => {
    if (this.mouseOverRecord !== undefined) {
      if (this.mouseOverRecord.rowId !== record.rowId) {
        // Mouse is over a different row, fire mouseleave on the previous record.
        mlTableService.rowMouseleave.changed(this.mouseOverRecord, 'annotation');

        // fire mouseenter on the new record.
        mlTableService.rowMouseenter.changed(record, 'annotation');
      }
    } else {
      // Mouse is now over a row, fire mouseenter on the record.
      mlTableService.rowMouseenter.changed(record, 'annotation');
    }

    this.mouseOverRecord = record;
  }

  onMouseLeaveRow = () => {
    if (this.mouseOverRecord !== undefined) {
      mlTableService.rowMouseleave.changed(this.mouseOverRecord, 'annotation');
      this.mouseOverRecord = undefined;
    }
  };

  render() {
    const {
      isSingleMetricViewerLinkVisible = true,
      isNumberBadgeVisible = false
    } = this.props;

    if (this.props.annotations === undefined) {
      if (this.state.isLoading === true) {
        return (
          <EuiFlexGroup justifyContent="spaceAround">
            <EuiFlexItem grow={false}><EuiLoadingSpinner size="l"/></EuiFlexItem>
          </EuiFlexGroup>
        );
      }

      if (this.state.errorMessage !== undefined) {
        return (
          <EuiCallOut
            title={this.state.errorMessage}
            color="danger"
            iconType="cross"
          />
        );
      }
    }

    const annotations = this.props.annotations || this.state.annotations;

    if (annotations.length === 0) {
      return (
        <EuiCallOut
          title="No annotations created for this job"
          iconType="iInCircle"
        >
          {this.state.jobId && isTimeSeriesViewJob(this.getJob(this.state.jobId)) &&
            <p>
              To create an annotation,
              open the <EuiLink onClick={() => this.openSingleMetricView()}>Single Metric Viewer</EuiLink>
            </p>
          }
        </EuiCallOut>
      );
    }

    function renderDate(date) { return formatDate(date, TIME_FORMAT); }

    const columns = [
      {
        field: 'annotation',
        name: 'Annotation',
        sortable: true
      },
      {
        field: 'timestamp',
        name: 'From',
        dataType: 'date',
        render: renderDate,
        sortable: true,
      },
      {
        field: 'end_timestamp',
        name: 'To',
        dataType: 'date',
        render: renderDate,
        sortable: true,
      },
      {
        field: 'create_time',
        name: 'Creation date',
        dataType: 'date',
        render: renderDate,
        sortable: true,
      },
      {
        field: 'create_username',
        name: 'Created by',
        sortable: true,
      },
      {
        field: 'modified_time',
        name: 'Last modified date',
        dataType: 'date',
        render: renderDate,
        sortable: true,
      },
      {
        field: 'modified_username',
        name: 'Last modified by',
        sortable: true,
      },
    ];

    const jobIds = _.uniq(annotations.map(a => a.job_id));
    if (jobIds.length > 1) {
      columns.unshift({
        field: 'job_id',
        name: 'job ID',
        sortable: true,
      });
    }

    if (isNumberBadgeVisible) {
      columns.unshift({
        field: 'key',
        name: 'Label',
        sortable: true,
        width: '60px',
        render: (key) => {
          return (
            <EuiBadge color="default">
              {key}
            </EuiBadge>
          );
        }
      });
    }

    if (isSingleMetricViewerLinkVisible) {
      columns.push({
        align: RIGHT_ALIGNMENT,
        width: '60px',
        name: 'View',
        render: (annotation) => {
          const isDrillDownAvailable = isTimeSeriesViewJob(this.getJob(annotation.job_id));
          const openInSingleMetricViewerText = isDrillDownAvailable
            ? 'Open in Single Metric Viewer'
            : 'Job configuration not supported in Single Metric Viewer';

          return (
            <EuiToolTip
              position="bottom"
              content={openInSingleMetricViewerText}
            >
              <EuiButtonIcon
                onClick={() => this.openSingleMetricView(annotation)}
                disabled={!isDrillDownAvailable}
                iconType="stats"
                aria-label={openInSingleMetricViewerText}
              />
            </EuiToolTip>
          );
        }
      });
    }

    const getRowProps = (item) => {
      return {
        onMouseOver: () => this.onMouseOverRow(item),
        onMouseLeave: () => this.onMouseLeaveRow()
      };
    };

    return (
      <EuiInMemoryTable
        className="eui-textOverflowWrap"
        compressed={true}
        items={annotations}
        columns={columns}
        pagination={{
          pageSizeOptions: [5, 10, 25]
        }}
        sorting={{
          sort: {
            field: 'timestamp', direction: 'asc'
          }
        }}
        rowProps={getRowProps}
      />
    );
  }
}
AnnotationsTable.propTypes = {
  annotations: PropTypes.array,
  jobs: PropTypes.array,
  isSingleMetricViewerLinkVisible: PropTypes.bool,
  isNumberBadgeVisible: PropTypes.bool
};

export { AnnotationsTable };
