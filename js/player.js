(function () {
	window.AudioContext = window.AudioContext || window.webkitAudioContext;

	var audio_context = new AudioContext();

	function AudioTimer () {
		this.audio_context = audio_context;
		this.reset();
	}

	AudioTimer.prototype.reset = function() {
		return this.last = audio_context.currentTime;
	};

	AudioTimer.prototype.time = function(first_argument) {
		return audio_context.currentTime - this.last;
	};

	///////////////////////////////////////////////////////////////////////////
	// Visualizers

	function Visualizer (analyser, period, canvas) {
		this.analyser = analyser;
		this.period = period;
		this.canvas = canvas;
		this.width = canvas.width;
		this.height = canvas.height;
		this.context = canvas.getContext('2d');
	}

	Visualizer.prototype.clear = function() {
		this.context.fillStyle = '#333';
		this.context.fillRect(0, 0, this.width, this.height);
	};

	Visualizer.prototype.start = function() {
		var visualizer = this;
		this._timerId = setInterval(function () {
			visualizer.refresh();
		}, this.period);
	};

	Visualizer.prototype.stop = function() {
		this.clear();
		clearInterval(this._timerId);
	};

	///////////////////////////////////////////////////////////////////////////
	// Frequency visualizer 

	function FrequencyVisualizer (analyser, period, canvas) {
		Visualizer.call(this, analyser, period, canvas);
		this.clear();
		this.data = new Uint8Array(this.analyser.frequencyBinCount);
		this.barWidth = this.width/this.analyser.frequencyBinCount;
		this.type = "frequency";
	}

	FrequencyVisualizer.prototype = Object.create(Visualizer.prototype);

	FrequencyVisualizer.prototype.refresh = function() {
		this.clear();
		this.analyser.getByteFrequencyData(this.data);
		for (var i = 0; i < this.data.length; ++i) {
			var magnitude = (this.data[i]/255)*this.height;
			this.context.fillStyle = (['#ff9700', '#ffc300'])[i%2];
			this.context.fillRect(i*this.barWidth, this.height, this.barWidth, -magnitude);
		}
	};

	///////////////////////////////////////////////////////////////////////////
	// Time domain visualizer

	function TimeDomainVisualizer (analyser, period, canvas) {
		Visualizer.call(this, analyser, period, canvas);
		this.clear();
		this.data = new Uint8Array(analyser.fftSize);
		this.barWidth = this.width/analyser.fftSize;
		this.type = "timedomain";
	}

	TimeDomainVisualizer.prototype = Object.create(Visualizer.prototype);

	TimeDomainVisualizer.prototype.refresh = function () {
		this.clear();
		this.analyser.getByteTimeDomainData(this.data);
		this.context.beginPath();
		for (var i = 0; i < this.data.length; ++i) {
			var value = this.data[i]/2;
			if (i == 0) {
				this.context.moveTo(i*this.barWidth, value);				
			} else {
				this.context.lineTo(i*this.barWidth, value);
			}
		}
		this.context.strokeStyle = '#ff9700';
		this.context.lineWidth = 2;
		this.context.stroke();
	};

	TimeDomainVisualizer.prototype.stop = function () {
		Visualizer.prototype.stop.call(this);
		this.context.beginPath();
		this.context.moveTo(0, this.height/2);
		this.context.lineTo(this.width, this.height/2);
		this.context.strokeStyle = '#ff9700';
		this.context.lineWidth = 2;
		this.context.stroke();
	}

	///////////////////////////////////////////////////////////////////////////
	// Player

	function Player (player_ui) {
		this.ui = player_ui;

		this.audio_analyser = audio_context.createAnalyser();
		this.audio_analyser.fftSize = 512;
		this.audio_analyser.connect(audio_context.destination);

		this.audio_timer = new AudioTimer();
		this.audio_source = null;
		this.audio_node = null;

		this.canvas = (this.ui.find('#spectrum-analyser').get())[0];
		this.canvas.width = 768;
		this.canvas.height = 128;

		// this.visualizer = new FrequencyVisualizer(this.audio_analyser, 32, canvas);
		this.visualizer = new TimeDomainVisualizer(this.audio_analyser, 64, this.canvas);
		this.visualizer.stop();
	}

	Player.prototype.togglePlay = function () {
		if (this.audio_source) {   // A song has been loaded
			if (this.audio_node) { // We were playing -> pause
				this.audio_node.stop(0);
				this.audio_offset += this.audio_timer.time();
				this.audio_node = null;
				this.visualizer.stop();
			} else {                 // We were not playing -> play
				this.audio_node = audio_context.createBufferSource();
				this.audio_node.buffer = this.audio_source;
				this.audio_node.connect(this.audio_analyser);
				this.audio_node.start(0, this.audio_offset);
				this.audio_timer.reset();
				this.visualizer.start();
			}
		}
	};

	Player.prototype.stop = function () {
		if (this.audio_node) {
			this.togglePlay();
			this.audio_offset = 0;
			$('#song-play', this.ui)
				.children()
					.children().toggleClass("icon-pause").toggleClass("icon-play");
		}
	};

	Player.prototype.enableTransport = function () {
		var player = this;

		function song_play_click_handler (ev) {
			ev.preventDefault();
			$(this).children()
				.toggleClass('icon-pause')
				.toggleClass('icon-play');
			player.togglePlay();
		}

		function song_stop_click_handler (ev) {
			ev.preventDefault();
			player.stop();
		}

		function song_view_click_handler (ev) {
			player.visualizer.stop();
			if (player.visualizer.type == "frequency") {
				player.visualizer = new TimeDomainVisualizer(player.audio_analyser, 64, player.canvas);
			} else {
				player.visualizer = new FrequencyVisualizer(player.audio_analyser,  32, player.canvas);
			}

			if (player.audio_node) {
				player.visualizer.start();
			} else {
				player.visualizer.stop();
			}
		}

		$('#transport-bar', player.ui)
			.children().show()
				.filter('#song-play')
					.children().click(song_play_click_handler).end().end()
				.filter('#song-stop')
					.children().click(song_stop_click_handler).end().end()
				.filter('#song-spectrum')
					.children().click(song_view_click_handler).end().end();
	};

	Player.prototype.disableTransport = function () {
		$('#transport-bar', this.ui)
			.children()
				.hide().children().off('click').end().end();
	};

	Player.prototype.load = function(uri) {
		var player = this;

		player.disableTransport();
		player.ui.find('#song-spinner').show();

		var request = new XMLHttpRequest();

		request.open('GET', uri, true);
		request.responseType = 'arraybuffer';
		request.onload = function () {
			// decode the response array buffer
			audio_context.decodeAudioData(request.response, function (buffer) {
				player.audio_source = buffer;
				player.audio_offset = 0;
				player.enableTransport();
				player.ui.find('#song-spinner').hide();
			});
		};
		request.send();
	};

	$(document).ready(function () {
		var player = new Player($("#player-wrapper"));
		player.load("./data/40a45c8e503d28ed58206be086e5a588b551df0e.mp3");
	});
})()