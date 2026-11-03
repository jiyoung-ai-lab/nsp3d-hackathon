// NSP3D - Neural Fiber Visualization
// Organic Connectome / Dark Scientific Style
// Three.js 0.160.0

import * as THREE from 'three';

export class NeuralFiberView {

    constructor(container, options = {}) {

        this.container = container;

        this.options = {
            background: 0x000000,
            fiberColor: 0xdce5eb,
            activeColor: 0x9fffe8,
            fiberOpacity: 0.22,
            activeOpacity: 0.95,
            particleCount: 1,
            maxParticles: 300,
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
            3000
        );

        this.camera.position.set(0, 0, 150);

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

        this.clock = new THREE.Clock();

        this.createScene();

        this.resizeObserver = new ResizeObserver(
            () => this.resize()
        );

        this.resizeObserver.observe(container);

        this.animate();
    }

    // -----------------------------------------
    // Scene
    // -----------------------------------------

    createScene() {

        const ambient = new THREE.AmbientLight(
            0xffffff,
            0.5
        );

        this.scene.add(ambient);

        // 은은한 공간감
        const points = new THREE.BufferGeometry();

        const positions = [];

        for (let i = 0; i < 180; i++) {

            positions.push(
                (Math.random() - 0.5) * 400,
                (Math.random() - 0.5) * 300,
                (Math.random() - 0.5) * 250
            );
        }

        points.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );

        const stars = new THREE.Points(
            points,
            new THREE.PointsMaterial({
                color: 0x64717d,
                size: 0.35,
                transparent: true,
                opacity: 0.2
            })
        );

        this.scene.add(stars);
    }

    // -----------------------------------------
    // Graph
    // -----------------------------------------

    setGraph(nodes, edges) {

        this.clearGraph();

        const positions = new Map();

        nodes.forEach(node => {

            if (![node.x, node.y, node.z].every(Number.isFinite)) {
                return;
            }

            const position = new THREE.Vector3(
                node.x,
                node.y,
                node.z
            );

            positions.set(node.id, position);

            // 구슬 대신 작은 섬유 집합점
            const geometry = new THREE.BufferGeometry();

            geometry.setAttribute(
                'position',
                new THREE.Float32BufferAttribute(
                    [0, 0, 0],
                    3
                )
            );

            const material = new THREE.PointsMaterial({
                color: 0xeaf2f7,
                size: 0.7,
                transparent: true,
                opacity: 0.4,
                sizeAttenuation: true
            });

            const point = new THREE.Points(
                geometry,
                material
            );

            point.position.copy(position);

            this.scene.add(point);

            this.nodeMap.set(node.id, {
                position,
                object: point,
                data: node,
                activation: 0
            });
        });

        edges.forEach(edge => {

            const source = positions.get(edge.source);
            const target = positions.get(edge.target);

            if (!source || !target) return;

            const curve = this.createFiberCurve(
                source,
                target
            );

            const points = curve.getPoints(18);

            const geometry = new THREE.BufferGeometry()
                .setFromPoints(points);

            const material = new THREE.LineBasicMaterial({
                color: this.options.fiberColor,
                transparent: true,
                opacity: this.options.fiberOpacity
            });

            const line = new THREE.Line(
                geometry,
                material
            );

            this.scene.add(line);

            const key = `${edge.source}->${edge.target}`;

            this.edgeMap.set(key, {
                line,
                curve,
                source: edge.source,
                target: edge.target,
                weight: edge.weight ?? 1
            });
        });
    }

    // -----------------------------------------
    // Organic fiber shape
    // -----------------------------------------

    createFiberCurve(start, end) {

        const direction = new THREE.Vector3()
            .subVectors(end, start);

        const length = direction.length();

        const midpoint = new THREE.Vector3()
            .addVectors(start, end)
            .multiplyScalar(0.5);

        const randomOffset = length * 0.09;

        const control1 = new THREE.Vector3(
            start.x + direction.x * 0.25 +
                (Math.random() - 0.5) * randomOffset,

            start.y + direction.y * 0.25 +
                (Math.random() - 0.5) * randomOffset,

            start.z + direction.z * 0.25 +
                (Math.random() - 0.5) * randomOffset
        );

        const control2 = new THREE.Vector3(
            midpoint.x +
                (Math.random() - 0.5) * randomOffset,

            midpoint.y +
                (Math.random() - 0.5) * randomOffset,

            midpoint.z +
                (Math.random() - 0.5) * randomOffset
        );

        const control3 = new THREE.Vector3(
            end.x - direction.x * 0.25 +
                (Math.random() - 0.5) * randomOffset,

            end.y - direction.y * 0.25 +
                (Math.random() - 0.5) * randomOffset,

            end.z - direction.z * 0.25 +
                (Math.random() - 0.5) * randomOffset
        );

        return new THREE.CubicBezierCurve3(
            start,
            control1,
            control3,
            end
        );
    }

    // -----------------------------------------
    // Activity
    // -----------------------------------------

    updateActivity(activity) {

        for (const [id, node] of this.nodeMap) {

            const value = Math.max(
                0,
                Math.min(1, Number(activity[id]) || 0)
            );

            node.activation = value;

            node.object.material.opacity =
                0.2 + value * 0.8;

            node.object.material.size =
                0.6 + value * 1.5;

            node.object.material.color.setRGB(
                0.7 + value * 0.3,
                0.7 + value * 0.3,
                0.7 + value * 0.3
            );
        }
    }

    // -----------------------------------------
    // Signal pulse
    // -----------------------------------------

    pulse(sourceId, targetId, strength = 1) {

        if (this.particles.length >= this.options.maxParticles) {
            return false;
        }

        const key = `${sourceId}->${targetId}`;

        const edge = this.edgeMap.get(key);

        if (!edge) return false;

        const material = new THREE.MeshBasicMaterial({
            color: this.options.activeColor
        });

        const particle = new THREE.Mesh(
            new THREE.SphereGeometry(0.35, 8, 8),
            material
        );

        this.scene.add(particle);

        this.particles.push({
            mesh: particle,
            curve: edge.curve,
            progress: 0,
            speed: 0.55,
            strength
        });

        return true;
    }

    // -----------------------------------------
    // Animation
    // -----------------------------------------

    animate = () => {

        this.animationId = requestAnimationFrame(
            this.animate
        );

        const delta = Math.min(
            this.clock.getDelta(),
            0.05
        );

        for (let i = this.particles.length - 1; i >= 0; i--) {

            const p = this.particles[i];

            p.progress += delta * p.speed;

            const t = Math.min(p.progress, 1);

            p.mesh.position.copy(
                p.curve.getPoint(t)
            );

            if (t >= 1) {

                this.scene.remove(p.mesh);

                p.mesh.geometry.dispose();
                p.mesh.material.dispose();

                this.particles.splice(i, 1);
            }
        }

        this.renderer.render(
            this.scene,
            this.camera
        );
    };

    // -----------------------------------------
    // Cleanup
    // -----------------------------------------

    clearGraph() {

        for (const node of this.nodeMap.values()) {

            this.scene.remove(node.object);

            node.object.geometry.dispose();
            node.object.material.dispose();
        }

        for (const edge of this.edgeMap.values()) {

            this.scene.remove(edge.line);

            edge.line.geometry.dispose();
            edge.line.material.dispose();
        }

        this.nodeMap.clear();
        this.edgeMap.clear();
    }

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

        this.particles.forEach(p => {
            p.mesh.geometry.dispose();
            p.mesh.material.dispose();
            this.scene.remove(p.mesh);
        });

        this.particles = [];

        this.renderer.dispose();
        this.renderer.domElement.remove();
    }
}
