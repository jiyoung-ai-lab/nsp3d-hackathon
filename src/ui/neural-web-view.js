// neural-web-view.js
// NSP3D - Neural Web Visualization
// Three.js 0.160.0
//
// Input:
// nodes: [{ id, x, y, z, name, region }]
// edges: [{ source, target, weight }]
//
// Activity:
// updateActivity({ neuronId: activation })
// pulse(sourceId, targetId)

import * as THREE from 'three';

export class NeuralWebView {

    constructor(container, options = {}) {

        this.container = container;

        this.options = {
            background: 0x000000,
            nodeSize: 0.42,
            lineOpacity: 0.32,
            activeThreshold: 0.05,
            ...options
        };

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(
            this.options.background
        );

        this.camera = new THREE.PerspectiveCamera(
            45,
            container.clientWidth / container.clientHeight,
            0.1,
            2000
        );

        this.camera.position.set(0, 0, 180);

        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false
        });

        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, 2)
        );

        this.renderer.setSize(
            container.clientWidth,
            container.clientHeight
        );

        container.appendChild(this.renderer.domElement);

        this.nodeMap = new Map();
        this.edgeMap = new Map();
        this.particles = [];

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.onNeuronSelect = null;

        this.clock = new THREE.Clock();

        this.createLights();

        this.renderer.domElement.addEventListener(
            'pointerdown',
            e => this.handlePointer(e)
        );

        this.resizeObserver = new ResizeObserver(
            () => this.resize()
        );

        this.resizeObserver.observe(container);

        this.animate();
    }

    createLights() {

        const ambient = new THREE.AmbientLight(
            0xffffff,
            0.7
        );

        this.scene.add(ambient);

        const light = new THREE.PointLight(
            0xffffff,
            1.5
        );

        light.position.set(0, 0, 100);

        this.scene.add(light);
    }

    // ------------------------------------------------
    // Build neural network
    // ------------------------------------------------

    setGraph(nodes, edges) {

        this.clearGraph();

        const positions = new Map();

        nodes.forEach((node, index) => {

            const angle = index * 2.39996;

            // 좌표가 없는 뉴런을 위한 시각화용 배치.
            // 해부학적 좌표가 있다면 실제 좌표를 사용한다.

            const radius = 30 + Math.sqrt(index) * 3;

            const x = Number.isFinite(node.x)
                ? node.x : Math.cos(angle) * radius;

            const y = Number.isFinite(node.y)
                ? node.y : Math.sin(angle) * radius;

            const z = Number.isFinite(node.z)
                ? node.z : Math.sin(index * 0.31) * 25;

            positions.set(node.id, new THREE.Vector3(x, y, z));

            const geometry = new THREE.SphereGeometry(
                this.options.nodeSize,
                12,
                12
            );

            const material = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.72
            });

            const mesh = new THREE.Mesh(
                geometry,
                material
            );

            mesh.position.copy(positions.get(node.id));

            mesh.userData = {
                ...node,
                activation: 0
            };

            this.scene.add(mesh);

            this.nodeMap.set(node.id, mesh);
        });

        // 실제 연결 관계로 섬유 생성

        edges.forEach(edge => {

            const source = positions.get(edge.source);
            const target = positions.get(edge.target);

            if (!source || !target) return;

            const geometry = new THREE.BufferGeometry()
                .setFromPoints([source, target]);

            const material = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: this.options.lineOpacity
            });

            const line = new THREE.Line(
                geometry,
                material
            );

            this.scene.add(line);

            const key = `${edge.source}->${edge.target}`;

            this.edgeMap.set(key, {
                line,
                source: edge.source,
                target: edge.target,
                weight: edge.weight ?? 1
            });
        });
    }

    clearGraph() {

        for (const node of this.nodeMap.values()) {

            this.scene.remove(node);

            node.geometry.dispose();
            node.material.dispose();
        }

        for (const edge of this.edgeMap.values()) {

            this.scene.remove(edge.line);

            edge.line.geometry.dispose();
            edge.line.material.dispose();
        }

        this.nodeMap.clear();
        this.edgeMap.clear();
    }

    // ------------------------------------------------
    // Neuron activity
    // ------------------------------------------------

    updateActivity(activity) {

        for (const [id, mesh] of this.nodeMap) {

            const value = Math.max(
                0,
                Math.min(1, Number(activity[id]) || 0)
            );

            mesh.userData.activation = value;

            const active =
                value >= this.options.activeThreshold;

            // 발화 강도에 따른 밝기

            mesh.material.opacity =
                0.35 + value * 0.65;

            mesh.scale.setScalar(
                1 + value * 1.8
            );

            mesh.material.color.setRGB(
                0.65 + value * 0.35,
                0.65 + value * 0.35,
                0.65 + value * 0.35
            );

            if (active) {
                mesh.material.opacity = 1;
            }
        }
    }

    // ------------------------------------------------
    // Signal transmission
    // ------------------------------------------------

    pulse(sourceId, targetId, strength = 1) {

        const key = `${sourceId}->${targetId}`;

        const edge = this.edgeMap.get(key);

        if (!edge) return false;

        const source = this.nodeMap.get(sourceId);
        const target = this.nodeMap.get(targetId);

        if (!source || !target) return false;

        const particleGeometry =
            new THREE.SphereGeometry(0.65, 8, 8);

        const particleMaterial =
            new THREE.MeshBasicMaterial({
                color: 0xffffff
            });

        const particle = new THREE.Mesh(
            particleGeometry,
            particleMaterial
        );

        this.scene.add(particle);

        this.particles.push({
            mesh: particle,
            source: source.position.clone(),
            target: target.position.clone(),
            progress: 0,
            speed: 0.9,
            strength
        });

        // 연결선 순간 강조

        edge.line.material.opacity = 1;

        return true;
    }

    // ------------------------------------------------
    // Selection
    // ------------------------------------------------

    handlePointer(event) {

        const rect =
            this.renderer.domElement.getBoundingClientRect();

        this.pointer.x =
            ((event.clientX - rect.left) / rect.width) * 2 - 1;

        this.pointer.y =
            -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.pointer,
            this.camera
        );

        const objects = [...this.nodeMap.values()];

        const hits = this.raycaster.intersectObjects(objects);

        if (hits.length > 0) {

            const selected = hits[0].object;

            if (this.onNeuronSelect) {
                this.onNeuronSelect(selected.userData);
            }
        }
    }

    // ------------------------------------------------
    // Resize / Dispose
    // ------------------------------------------------

    resize() {

        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        if (!width || !height) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();

        this.renderer.setSize(width, height);
    }

    dispose() {

        cancelAnimationFrame(this.animationId);

        this.resizeObserver.disconnect();

        this.clearGraph();

        for (const p of this.particles) {

            p.mesh.geometry.dispose();
            p.mesh.material.dispose();

            this.scene.remove(p.mesh);
        }

        this.particles = [];

        this.renderer.dispose();

        this.renderer.domElement.remove();
    }

    // ------------------------------------------------
    // Animation
    // ------------------------------------------------

    animate = () => {

        this.animationId = requestAnimationFrame(
            this.animate
        );

        const delta = Math.min(
            this.clock.getDelta(),
            0.05
        );

        // 신호 입자 이동

        for (let i = this.particles.length - 1; i >= 0; i--) {

            const p = this.particles[i];

            p.progress += delta * p.speed;

            const t = Math.min(p.progress, 1);

            p.mesh.position.lerpVectors(
                p.source,
                p.target,
                t
            );

            if (t >= 1) {

                this.scene.remove(p.mesh);

                p.mesh.geometry.dispose();
                p.mesh.material.dispose();

                this.particles.splice(i, 1);
            }
        }

        // 연결선 발광은 서서히 감소

        for (const edge of this.edgeMap.values()) {

            edge.line.material.opacity +=
                (this.options.lineOpacity -
                 edge.line.material.opacity) * delta * 3;
        }

        this.renderer.render(
            this.scene,
            this.camera
        );
    };
}
