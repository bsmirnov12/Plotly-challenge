// JavaScript-challenge
// UT-TOR-DATA-PT-01-2020-U-C Week 15 Homework
// (c) Boris Smirnov

// Set footer background to match jumbotron's
var jumboNode = $('.jumbotron')
$('.page-footer').css('background', jumboNode.css('background-color'));


/************************************************************/
/*                          GLOBALS                         */
/************************************************************/

/**
 * Plotly has integrated D3 library
 * The only problem is that it is v3.5.17 (vs v5.16 as of today)
 * join() is unsupported, d3.json().then().catch() doesn't work either...
 */
const d3 = Plotly.d3;
// console.log(d3.version);

/**
 * Contains data fetched from the server
 * After fetching data it is validated and indexes to correct items are saved into index array
 */
var rawData = {};
  
/**
 * An array of indexes of items in {@link rawData} that passed validation and can be used for charting.
 */
var index = [];

/**
 * The range of OTU Ids in {@link rawData}.
 * Used later for the color range on the bubble chart is uniform for all samples.
 * Real values are assigned after loading data
 */
var otu_min = 0;
var otu_max = 3500;

/**
 * Global constant: maximum number of scrubs per week
 * Values above this theashold are rounded down to this value
 */
const scrubs = 9;

/**
 * Default bubble opacity. Must be below 1.0
 */
const opacity = 0.66;

/************************************************************/
/*                         UTILITIES                        */
/************************************************************/

/**
 * Finds g.point element corresponding to the given data point on the Bubble Plot
 * Used by event handlers of Bar and Bubble charts
 * @param {integer} i - OTU index 
 * @return {Element} - g.point element
 */
function findGPoint(i) {
    const bubble = document.getElementById('bubble');
    const points = bubble.querySelector('g.scatterlayer g.points');
    return points.children[i];
}

/**
 * Formats bacteria label for display in a tooltip (Bar chart) or annotation (Bubble chart)
 * @param {string} s - bacteria taxonomy string
 */
function formatLabel(s) {
    const taxonomy = s.split(';').reverse();
    return taxonomy.join('<br>&#8593;<br>');
}


/************************************************************/
/*                    INITIALIZATION PART                   */
/************************************************************/

/**
 * Highlight or dimm a bubble on the Bubble Chart corresponding to a bar on the Bar Chart
 * (called from plotly_hover and plotly_unhover event handlers)
 * @param {Object} data - Plotly event data
 * @param {integer} o - desired bubble opacity
 */
function dimmer(data, o) {
    const dataPoint = data.points[0];
    if (dataPoint.data.meta === null) // no data, the chart is in the initial state
        return;
    // console.log(dataPoint);

    // Index of the sample (or test subject)
    const subjectIdx = dataPoint.data.meta;

    // The bar chart shows (up to) Top 10 OTUs in reverse order.
    // Thus, to get real otuIdx we must...
    const otuIdx = dataPoint.data.y.length - dataPoint.pointIndex - 1;

    // Check
    // console.log(`plotly_hover: bar label "${dataPoint.y}", OTU ${rawData.samples[subjectIdx].otu_ids[otuIdx]}`);

    // Highlight/dimm
    const bubble = findGPoint(otuIdx);
    bubble.style.opacity = o;
    // bubble.style.stroke = o == opacity ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
}

/**
 * Initialize Horizontal Bar Chart.
 */
function initHBar() {
    const xValues = d3.range(1, 11).map(v => 5 - 4 * Math.cos(v * 2 * Math.PI / 11));
    const yValues = d3.range(1, 11).map( v => `No. ${v} `);

    const trace = {
        type: 'bar',
        orientation: 'h',
        x: xValues,
        y: yValues,
        meta: null,
        hovertext: "No data",
        marker: {color: 'rgb(255, 194, 166)'}
    };

    const layout = {
        title: "<b>No data</b>",
        font: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 14
        }
    };

    const config = {responsive: true};

    Plotly.react("hbar", [trace], layout, config).then(function() {
        // Install event handlers for managing bubble highlighting
        let hbar = document.getElementById('hbar');
        if (hbar.hasAttribute('handlersInstalled'))
            return;

        hbar.on('plotly_hover',   data => { dimmer(data, 1.0); });
        hbar.on('plotly_unhover', data => { dimmer(data, opacity); });
        hbar.setAttribute('handlersInstalled', true);
    });
}

/**
 * Object that handles plot redrawing event ('plotly_afterplot')
 * and draws the needle on the layer above piechart that mimics indicator plot
 */
var needleArtist = {
    aX: 1.0,                // aspect ratio of X axis
    aY: 1.0,                // aspect ratio of Y axis
    recursiveCall: false,   // prevent recursive calls of the event handler (it might trigger the same event it handles)
    needlePos: -1,          // saved needle position (for redrawing the needle on plot resize)

    /**
     * Initialize aspect ratio coefficients
     */
    init: function() {
        const gauge = document.getElementById('gauge');
        const pie_layer = gauge.querySelector('g.pielayer');
        const layer_above = gauge.querySelector('g.layer-above');
    
        const w0 = pie_layer.getBoundingClientRect().width;
        const h0 = pie_layer.getBoundingClientRect().height;
    
        const w1 = layer_above.getBoundingClientRect().width;
        const h1 = layer_above.getBoundingClientRect().height;
    
        this.aX = 1.0 * w0 / w1;
        this.aY = 1.0 * h0 / h1;

        // console.log(`needleArtist.init(): pie = [${w0.toFixed(1)} x ${h0.toFixed(1)}], layer = [${w1.toFixed(1)} x ${h1.toFixed(1)}]`);
    },

    /**
     * Converts pie layer X coordinate to upper layer X coordinate
     * @param {number} x - X coorDinate to convert 
     */
    fX: function(x) { return 0.5 - (0.5 - x) * this.aX },

    /**
     * Converts pie layer Y coordinate to upper layer Y coordinate
     * @param {number} y - Y coorDinate to convert 
     */
    fY: function(y) { return 0.5 - (0.5 - y) * this.aY },

    /**
     * Generates a needle (SVG path) rotated to a specified angle
     * @param {integer} n - segment number
     * @returns {string} - SVG path
     */
    makeNeedlePath: function(n) {

        // Center point
        const x0 = 0.5, y0 = 0.5;
    
        // Path points for default (zero pointing) needle
        // Coordinates are absolute.
        // "M0.25 0.5 L0.53 0.52 L0.51 0.5 L0.53 0.48 Z"
        const path = [{x:0.25, y:0.50}, {x:0.53, y:0.52}, {x:0.51, y:0.50}, {x:0.53, y:0.48}];
    
        // By default use saved needle position
        if (n === undefined)
            n = this.needlePos;

        // Calculating rotation angle
        const angle = Math.PI * n / scrubs;
        
        // Coordinate transformation - rotation and scaling
        // https://en.wikipedia.org/wiki/Rotation_matrix
        const newPath = path.map(p => {
            return {
                x: this.fX(x0 + (p.x - x0) * Math.cos(angle) + (p.y - y0) * Math.sin(angle)),
                y: this.fY(y0 - (p.x - x0) * Math.sin(angle) + (p.y - y0) * Math.cos(angle))
            };
        });

        var s = "";
        for (let i = 0; i < newPath.length; i++) {
            var command = i ? ' L' : 'M'; // M - move, L - draw line
            s += `${command}${newPath[i].x} ${newPath[i].y}`;
        }
        s += ' Z'; // Z - close the contour
    
        return s;
    },
    
    /**
     * Draws the needle. Saves current needle position
     * @param {number} pos - position where the needle should point 
     */
    draw: function(pos) {
        // By default redraw saved needle position
        if (pos === undefined)
            pos = this.needlePos;

        // Check if needle position is in valid range and save new position
        this.needlePos = pos < 0 ? -0.5 : pos > scrubs ? scrubs + 0.5 : pos;

        const layout = {
            shapes: [
                // transparent "circle" used for aspect ratio calculations
                {type:'circle', x0:0.0,  y0:0.0,  x1:1.0,  y1:1.0, opacity: 0.0},
                // the needle
                {type: "path", path:this.makeNeedlePath(), line: {color:'#EB6864', width: 1}, fillcolor:'#EB6864'}
            ]
        }

        // This object is an event handler, however, the next call triggers the same event,
        // so we need to protect ourselves from infinite recursive calls
        // P.S. seems this isn't true for 'plotly_afterplot' event that I use now (it was when I handled 'resize' event)
        this.recursiveCall = true;
        Plotly.relayout('gauge', layout).then(() => { this.recursiveCall = false; });
    },

    /**
     * Handles chart redrawing event
     * Called every time after the gauge plot is redrawn
     * Should be assigned indirectly as 'plotly_afterplot' event handler because it relies on `this` which is redefined in real event handlers
     * call as: event => { needleArtist.redraw(); }
     */
    redraw: function () {
        if (this.recursiveCall)
            return;

        const old_aX = this.aX;
        const old_aY = this.aY;
        this.init(); // calculate new aspect ratios after the plot was redrawn

        // check if the layers changed in size
        if (old_aX === this.aX && old_aY === this.aY) {
            return // nothing changed, bailing out
        } else {
            // redraw the needle taking into account changed layer sizes
            this.draw();
        }
    }
}

/**
 * Initialize Gauge Chart
 * The chart is simulated with a Pie Chart with transparent bottom half.
 * The needle is rendered separately in the corresponding update function
 */
function initGauge() {
    // color palette for gauge scale
    const colors = [ 
        'rgba(0, 0, 0, 0)', // transparent bottom part
        'rgb(255, 194, 166)', // undefined
        'rgb(248, 243, 236)',
        'rgb(244, 241, 229)',
        'rgb(233, 230, 202)',
        'rgb(229, 231, 179)',
        'rgb(213, 228, 157)',
        'rgb(183, 204, 146)',
        'rgb(140, 191, 136)',
        'rgb(138, 187, 143)',
        'rgb(133, 180, 138)',
        'rgb(126, 171, 131)'  // > scrubs
    ];

    const trace = {
        type: 'pie',
        showlegend: false,
        values: d3.range(scrubs + 3).map(n => n ? scrubs : scrubs**2 - scrubs*2),
        text: [''].concat(d3.range(scrubs + 1).map(n => n ? `<b>${n-1}-${n}</b>` : "<b>No data</b>")).concat([`<b>&gt;${scrubs}</b>`]),
        textposition: "inside",
        textinfo: "text",
        insidetextfont: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 16
        },
        insidetextorientation: "horizontal",
        hoverinfo: "none",
        marker: {
            colors: colors
        },
        hole: 0.5,
        direction: "clockwise",
        rotation: 90 + 180 / scrubs,
        sort: false
    }

    const layout = {
        title: "<b>Belly Button Washing Frequency</b><br>Scrubs per Week",
        font: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 14
        },
        margin: { t:100, b:0, l:0, r:30 },
        shapes: [{type:'circle', x0:0.0,  y0:0.0,  x1:1.0,  y1:1.0, layer: 'above', opacity: 0.0}] // for calibration
    }
        
    const config = {responsive: true};

    Plotly.newPlot('gauge', [trace], layout, config).then(function() {
        needleArtist.init(); // initialize aspect ratio coefficients (based on the calibration circle above)
        needleArtist.draw(); // draw the needle on default position
        const gauge = document.getElementById('gauge');
        gauge.on('plotly_afterplot', event => { needleArtist.redraw(); }); // handle plot resizing events
    });
}

/**
 * Adds annotations on the Bubble plot
 * https://plotly.com/javascript/text-and-annotations/#styling-and-formatting-annotations
 * https://plotly.com/javascript/plotlyjs-events/#event-data
 * @param {Array} data - event related data (data point etc)
 */
function annotateBubble(data) {
    const dataPoint = data.points[0];
    if (dataPoint.data.meta === null) // no data, the chart is in the initial state
        return;
    // console.log(dataPoint);

    const sampleIdx = dataPoint.data.meta; // index of test subject (the same as in select element)
    const otuIdx = dataPoint.pointIndex;   // index in otu_id, sample_values and otu_labels, as well as in dataPoint.data.x
    const label = formatLabel(rawData.samples[sampleIdx].otu_labels[otuIdx]);
    // console.log(`Subject: ${rawData.names[sampleIdx]}. OTU: ${dataPoint.x}. Label: `);
    // console.log(label);

    const point = findGPoint([otuIdx]);
    const color = point.style.fill;

    const annotation = {
        x: dataPoint.xaxis.d2l(dataPoint.x),
        y: dataPoint.yaxis.d2l(dataPoint.y),
        text: label,
        meta: otuIdx,
        arrowhead: 6,
        ax: 75,
        ay: -55,
        bgcolor: 'rgba(255, 255, 255, 0.9)',
        arrowcolor: color,
        font: {size:14},
        bordercolor: color,
        borderwidth: 4,
        borderpad: 4,
        captureevents: true
    };

    // Remove other annotations, if they exist:
    const bubble = document.getElementById('bubble');
    const annotationCount = (bubble.layout.annotations || []).length;
    let sameOTU = false;
    for (let i = annotationCount - 1; i >= 0; i--) {
        if (bubble.layout.annotations[i].meta === otuIdx)
            sameOTU = true;
        Plotly.relayout('bubble', 'annotations[' + i + ']', 'remove');
    }

    // Add new annotation:
    if (!sameOTU)
        Plotly.relayout('bubble', 'annotations[0]', annotation);
}

/**
 * Init Bubble Chart
 */
function initBubble() {
    const xValues = d3.range(otu_min, otu_max, 140);
    const yValues = xValues.map(v => 5 - 4 * Math.cos(v * 4 * Math.PI / otu_max));
    const maxVal = d3.max(yValues);
    const maxBubbleSize = 100;

    const trace = {
        x: xValues,
        y: yValues,
        meta: null,
        mode: 'markers',
        marker: {
            opacity: opacity,
            size: yValues,
            sizeref: 2.0 * maxVal / maxBubbleSize**2, // https://plotly.com/javascript/bubble-charts/#bubble-size-scaling-on-charts
            sizemode: 'area',
            color: xValues,
            colorscale: 'Earth', 
            cmin: otu_min,
            cmax: otu_max
        }
    };

    const layout = {
        title: "<b>No data</b>",
        font: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 14
        },
        height: 500
    };

    const config = {responsive: true};

    Plotly.react('bubble', [trace], layout, config).then(function() {
        // Install event handlers for managing annotations
        let bubble = document.getElementById('bubble');
        if (bubble.hasAttribute('handlersInstalled'))
            return;

        bubble.on('plotly_click', annotateBubble);
        bubble.on('plotly_clickannotation', (data) => {
            Plotly.relayout('bubble', 'annotations[' + data.index + ']', 'remove');
        });
        bubble.setAttribute('handlersInstalled', true);
    });
}

/**
 * Initialize the page with empty controls and charts. Used before data is loaded.
 * Initialized parts:
 *      - select control
 *      - empty demographic info card
 *      - empty horizontal bar chart (only axes, probably some animation)
 *      - empty gauge (only scale, may be a needle pointing to undefined)
 *      - empty bubble chart (only axes, probably some animation)
 */
function initPage() {

    // 1. Select control
    // nothing to do - no options in index.html

    // 2. Demographic info card
    // nothing to do - its spans are empty in index.html

    // 3. Horizontal Bar Chart
    initHBar();

    // 4. Gauge
    initGauge();

    //5. Bubble chart
    initBubble();

}


/************************************************************/
/*                        UPDATE PART                       */
/************************************************************/

/**
 * Fill Demographic Info table
 * @param {integer} i - test subject index of metadata
 */
function fillTable(i) {
    const meta = rawData.metadata[i];
    const table = d3.select("#dem-info");

    table.selectAll('span')
        .data(Object.values(meta))
        //.join('span')
            .classed('text-danger', v => v === null)
            .text(v => v === null ? 'No data' : v );
}

/**
 * Update Horizontal Bar Chart
 * @param {integer} i - index of test subject
 */
function updateHBar(i) {
    const sample = rawData.samples[i];

    if (!(sample.sample_values.length && sample.otu_ids.length && sample.otu_labels.length)) {
        // no data to display, show empty chart
        initHBar();
        return;
    }

    const trace = {
        type: 'bar',
        orientation: 'h',
        x: sample.sample_values.slice(0, 10).reverse(),
        y: sample.otu_ids.slice(0, 10).reverse().map(id => `OTU ${id} ` ),
        meta: i,
        hovertext: sample.otu_labels.slice(0, 10).reverse().map(s => formatLabel(s))
    };

    const layout = {
        title: "<b>Top 10 OTUs</b>",
        font: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 14
        }
    };

    const config = {responsive: true};

    Plotly.react("hbar", [trace], layout, config);
}

/**
 * Update Gauge Chart - point its needle to the scrubs number
 * @param {integer} i - index of test subject
 */
function updateGauge(i) {
    const subject = rawData.metadata[i];
    let wfreq = subject.wfreq;
    if (wfreq === null) {
        // console.log(`updateGauge: Id(${subject.id}).wfreq = ${wfreq}`);
        wfreq = -1; // negative value means no data
    }
    needleArtist.draw(wfreq);
}

/**
 * Update Bubble Chart
 * @param {integer} i - index of test subject
 */
function updateBubble(i) {
    const sample = rawData.samples[i];
    
    if (!(sample.sample_values.length && sample.otu_ids.length && sample.otu_labels.length)) {
        // no data to display, show empty chart
        initBubble();
        return;
    }

    const maxVal = d3.max(sample.sample_values);
    const maxBubbleSize = 100;

    var trace = {
        x: sample.otu_ids,
        y: sample.sample_values,
        meta: i,
        // text: sample.otu_labels.map(s => formatLabel(s)),
        mode: 'markers',
        marker: {
            opacity: opacity,
            size: sample.sample_values,
            sizeref: 2.0 * maxVal / maxBubbleSize**2, // https://plotly.com/javascript/bubble-charts/#bubble-size-scaling-on-charts
            sizemode: 'area',
            color: sample.otu_ids,
            colorscale: 'Earth', 
            cmin: otu_min, // determined after loading raw data
            cmax: otu_max
        }
    };

    const layout = {
        title: "<b>OTU sample volumes</b>",
        font: {
            family: "News Cycle, Arial Narrow Bold, sans-serif",
            size: 14
        }
    };

    const config = {responsive: true};

    Plotly.react('bubble', [trace], layout, config);
}

/**
 * Update page with new selected subject
 * @param {integer} i - optional index of test subject
 */
function updatePage(i) {
    fillTable(i);
    updateHBar(i);
    updateGauge(i);
    updateBubble(i);
}


/************************************************************/
/*                         DATA PART                        */
/************************************************************/

/** 
 * Function validates an item of {@link rawData}.
 * Given an index it can check names, metadata and samples for correctness.
 * @param {array} data - reference to the complete dataset
 * @param {integer} i - index of an item in data arrays
 * @return {boolean} - true if the item passed validation, false otherwise
*/
function isValid(data, i) {
    // For now just check if corresponding sample has values (arrays aren't empty)
    // return (data.samples[i].otu_ids.length && data.samples[i].otu_labels.length);

    // I gracefully handle empty data, so no need to validate...
    return true;
}

/**
 * Process data returned by d3.json()
 * @param {Object} data - contents of 
 */
function initData(data) {
    if (!data) {
        alert('Failed to load data. Check your internet connection and reload the page.');
        return;
    }
        
    rawData = data;
    data.names.forEach((_, i) => {
        if (isValid(data, i))
            index.push(i);
        else
            console.log(`Skipping id[${i}] = ${data.names[i]} - validation failed.`);
    });
    
    // console.log(`Indexed samples: ${index.length}`);

    // Parameters used in Bubble chart - OTU Ids range
    otu_min = d3.min(index.map(idx => data.samples[idx].otu_ids.length ? d3.min(data.samples[idx].otu_ids) : Infinity));
    otu_max = d3.max(index.map(idx => data.samples[idx].otu_ids.length ? d3.max(data.samples[idx].otu_ids) : -Infinity));
    // console.log(`OTU max id: ${otu_max}, min id: ${otu_min}`);

    // init selection options
    let select = d3.select("#subjects");
    select.selectAll('option')
        .data(index)
        // .join('option')
        .enter()
        .append('option')
            .attr('value', i => i)
            .text(i => rawData.names[i]);

    // Loading complete. Hide loading indicator
    let loader = document.getElementsByClassName('loading')[0];
    loader.style.display = 'none';

    // set event handler
    select.on('change', function() { updatePage(this.value) });
    // start with selection of the first option
    select.value = 0;
    updatePage(index[0]);
}

/**
 * Exception handler on data loading
 * @param {Object} error - error info
 */
function errorHandler(error) {
    alert('Failed to load data. Check your internet connection and reload the page.');
    console.log(error);
}


/************************************************************/
/*                BRINGING IT ALL TO LIFE                   */
/************************************************************/

initPage();
// initData(rawData);

// This doesn't work with integrated D3:
// d3.json('data/samples1.json')
//     .then(initData)
//     .catch(errorHandler);

d3.json('data/samples.json', initData);
