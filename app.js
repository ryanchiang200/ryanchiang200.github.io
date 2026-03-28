// 等待 DOM 加载完成
document.addEventListener("DOMContentLoaded", () => {
    
    // ==========================================
    // 第二步：酷炫的粒子交互背景 (Particles.js)
    // ==========================================
    // Particles.js 轻量且容易实现“触碰维度连线”的效果
    particlesJS("particles-js", {
        particles: {
            number: { 
                value: 80, // 粒子数量
                density: { enable: true, value_area: 800 } 
            },
            color: { value: "#38bdf8" }, // 现代科技蓝
            shape: { type: "circle" },
            opacity: { 
                value: 0.6, 
                random: true, 
                anim: { enable: true, speed: 1, opacity_min: 0.1, sync: false } 
            },
            size: { 
                value: 3, 
                random: true, 
                anim: { enable: true, speed: 2, size_min: 0.1, sync: false } 
            },
            line_linked: {
                enable: true,
                distance: 150, // 连线距离
                color: "#818cf8", // 泛紫的蓝色连线
                opacity: 0.4,
                width: 1.5
            },
            move: {
                enable: true,
                speed: 1.5, // 缓慢移动，营造飘渺感
                direction: "none",
                random: true,
                straight: false,
                out_mode: "out",
                bounce: false,
            }
        },
        interactivity: {
            detect_on: "canvas",
            events: {
                onhover: { 
                    enable: true, 
                    mode: "grab" // 鼠标悬停时形成强烈的抓取连线效果
                }, 
                onclick: { 
                    enable: true, 
                    mode: "push" // 点击时增加粒子，如涟漪散开
                }, 
                resize: true
            },
            modes: {
                grab: { 
                    distance: 250, 
                    line_linked: { opacity: 0.8 } 
                },
                push: { particles_nb: 3 }
            }
        },
        retina_detect: true
    });


    // ==========================================
    // 第三步：汉堡菜单和全屏遮罩层的交互逻辑
    // ==========================================
    const menuBtn = document.getElementById('menu-btn');
    const menuOverlay = document.getElementById('menu-overlay');
    const menuItems = document.querySelectorAll('.menu-item');

    // 切换菜单的开关状态
    const toggleMenu = () => {
        menuBtn.classList.toggle('active');
        menuOverlay.classList.toggle('active');
        
        // 当打开菜单时，阻止底层页面滚动 (可选)
        if(menuOverlay.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    };

    // 绑定点击事件给汉堡菜单
    menuBtn.addEventListener('click', toggleMenu);

    // 当点击菜单内的任何选项时，自动关闭遮罩层
    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            if (menuOverlay.classList.contains('active')) {
                toggleMenu();
            }
        });
    });


    // ==========================================
    // 第四步：平滑滚动和回到顶部功能 (Lenis)
    // ==========================================
    // 使用 Lenis 实现全局的丝滑惯性滚动
    const lenis = new Lenis({
        duration: 1.2, // 滚动持续时间
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // 缓动函数：使得开始快，结尾非常丝滑
        direction: 'vertical',
        gestureDirection: 'vertical',
        smooth: true,
        mouseMultiplier: 1,
        smoothTouch: false, // 手机端是否使用平滑 (通常保持原生较好)
        touchMultiplier: 2,
    });

    // 将 Lenis 接入 requestAnimationFrame 以持续更新
    function raf(time) {
        lenis.raf(time);
        requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);

    // 处理菜单选项的锚点点击，使用 Lenis 进行强制平滑滚动
    menuItems.forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault(); // 阻止浏览器默认的锚点瞬间跳转行为
            const targetSelector = this.getAttribute('data-target');
            const targetElement = document.querySelector(targetSelector);
            
            if (targetElement) {
                // lenis.scrollTo 支持传入 DOM 元素，并平滑滚动到那里
                lenis.scrollTo(targetElement, {
                    offset: 0, 
                    duration: 1.5, // 跨区域长滚动可以稍微延长一点展示缓动效果
                    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
                });
            }
        });
    });

});
