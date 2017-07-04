const sinon = require('sinon');
const lolex = require('lolex');
const Tracer = require('../src/tracer');
const BatchRecorder = require('../src/batch-recorder');
const TraceId = require('../src/tracer/TraceId');
const Annotation = require('../src/annotation');
const InetAddress = require('../src/InetAddress');
const {Some, None} = require('../src/option');
const ExplicitContext = require('../src/explicit-context');

describe('Batch Recorder', () => {
  it('should accumulate annotations into MutableSpans', () => {
    const logSpan = sinon.spy();

    const ctxImpl = new ExplicitContext();
    const logger = {logSpan};
    const recorder = new BatchRecorder({logger});
    const trace = new Tracer({ctxImpl, recorder});

    ctxImpl.scoped(() => {
      trace.setId(new TraceId({
        traceId: None,
        parentId: new Some('a'),
        spanId: 'c',
        sampled: new Some(true)
      }));

      trace.recordServiceName('SmoothieStore');
      trace.recordRpc('buySmoothie');
      trace.recordBinary('taste', 'banana');
      trace.recordAnnotation(new Annotation.ServerRecv());
      trace.recordAnnotation(new Annotation.LocalAddr({
        host: new InetAddress('127.0.0.1'),
        port: 7070
      }));

      // Should only log after the span is complete
      expect(logSpan.calledOnce).to.equal(false);
      trace.recordAnnotation(new Annotation.ServerSend());
      expect(logSpan.calledOnce).to.equal(true);

      const loggedSpan = logSpan.getCall(0).args[0];

      expect(loggedSpan.traceId.traceId).to.equal('a');
      expect(loggedSpan.traceId.parentId).to.equal('a');
      expect(loggedSpan.traceId.spanId).to.equal('c');
      expect(loggedSpan.name).to.eql(new Some('buySmoothie'));
      expect(loggedSpan.endpoint.host).to.equal(2130706433);
      expect(loggedSpan.endpoint.port).to.equal(7070);
      expect(loggedSpan.service).to.eql(new Some('SmoothieStore'));
      expect(loggedSpan.binaryAnnotations[0].key).to.equal('taste');
      expect(loggedSpan.binaryAnnotations[0].value).to.equal('banana');
      expect(loggedSpan.annotations[0].value).to.equal('sr');
      expect(loggedSpan.annotations[1].value).to.equal('ss');
    });
  });

  // Applications can override the span name via trace.recordRpc
  it('should record span name as last recordRpc', () => {
    const logSpan = sinon.spy();

    const ctxImpl = new ExplicitContext();
    const logger = {logSpan};
    const recorder = new BatchRecorder({logger});
    const trace = new Tracer({ctxImpl, recorder});

    ctxImpl.scoped(() => {
      trace.setId(new TraceId({
        traceId: None,
        parentId: new Some('a'),
        spanId: 'c',
        sampled: new Some(true)
      }));

      trace.recordServiceName('SmoothieStore');
      trace.recordRpc('buySmoothie');
      trace.recordAnnotation(new Annotation.ServerRecv());

      // some customization code scoped to this trace ID resets the span name
      trace.recordRpc('rentSmoothie');

      trace.recordAnnotation(new Annotation.ServerSend());

      const loggedSpan = logSpan.getCall(0).args[0];

      expect(loggedSpan.name).to.eql(new Some('rentSmoothie'));
    });
  });

  it('should set MutableSpan.startTimestamp to first record', () => {
    const clock = lolex.install(12345678);
    const logSpan = sinon.spy();

    const ctxImpl = new ExplicitContext();
    const logger = {logSpan};
    const recorder = new BatchRecorder({logger});
    const trace = new Tracer({ctxImpl, recorder});

    ctxImpl.scoped(() => {
      trace.setId(new TraceId({
        traceId: None,
        parentId: new Some('a'),
        spanId: 'c',
        sampled: new Some(true)
      }));
      trace.recordServiceName('SmoothieStore');
      trace.recordRpc('buySmoothie');
      trace.recordBinary('taste', 'banana');
      trace.recordAnnotation(new Annotation.ServerRecv());
      trace.recordAnnotation(new Annotation.ServerSend());

      const loggedSpan = logSpan.getCall(0).args[0];

      expect(loggedSpan.startTimestamp).to.equal(12345678000);

      clock.uninstall();
    });
  });

  it('should flush Spans not finished within a minute timeout', () => {
    const clock = lolex.install();

    const logSpan = sinon.spy();
    const ctxImpl = new ExplicitContext();
    const logger = {logSpan};
    const recorder = new BatchRecorder({logger});
    const trace = new Tracer({ctxImpl, recorder});

    ctxImpl.scoped(() => {
      trace.setId(new TraceId({
        traceId: None,
        parentId: new Some('a'),
        spanId: 'c',
        sampled: new Some(true)
      }));

      trace.recordServiceName('SmoothieStore');

      clock.tick('02'); // polling interval is every second
      expect(logSpan.calledOnce).to.equal(false);

      clock.tick('01:00'); // 1 minute is the default timeout
      expect(logSpan.calledOnce).to.equal(true);
    });

    clock.uninstall();
  });

  it('should capture ServerAddr event', () => {
    const logSpan = sinon.spy();

    const ctxImpl = new ExplicitContext();
    const logger = {logSpan};
    const recorder = new BatchRecorder({logger});
    const trace = new Tracer({ctxImpl, recorder});

    ctxImpl.scoped(() => {
      trace.setId(new TraceId({
        traceId: None,
        parentId: new Some('a'),
        spanId: 'c',
        sampled: new Some(true)
      }));
      trace.recordServiceName('client');
      trace.recordRpc('call');
      trace.recordAnnotation(new Annotation.ClientSend());
      trace.recordAnnotation(new Annotation.ServerAddr({
        serviceName: 'server',
        host: new InetAddress('127.0.0.2'),
        port: 7071
      }));
      trace.recordAnnotation(new Annotation.ClientRecv());

      const loggedSpan = logSpan.getCall(0).args[0];

      const spanJson = loggedSpan.toJSON();
      expect(spanJson.binaryAnnotations).to.deep.equal([
        {
          key: 'sa',
          value: true,
          endpoint: {
            serviceName: 'server',
            ipv4: '127.0.0.2',
            port: 7071
          }
        }
      ]);
    });
  });
});
