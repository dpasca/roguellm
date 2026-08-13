(function (root) {
    'use strict';

    const DIRECTIONS = [
        { name: 'e', dx: 1, dy: 0 },
        { name: 's', dx: 0, dy: 1 },
        { name: 'n', dx: 0, dy: -1 },
        { name: 'w', dx: -1, dy: 0 }
    ];

    function positionKey(x, y) {
        return `${x}:${y}`;
    }

    function distance(from, to) {
        return Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
    }

    function entityPosition(entity) {
        return [Number(entity.x), Number(entity.y)];
    }

    function nearestEntity(state, entities) {
        const start = state.player_pos || [0, 0];
        return entities.slice().sort((left, right) => {
            const distanceDifference = distance(start, entityPosition(left)) -
                distance(start, entityPosition(right));
            if (distanceDifference) return distanceDifference;
            if (left.y !== right.y) return left.y - right.y;
            return left.x - right.x;
        })[0] || null;
    }

    function isInside(state, x, y) {
        return x >= 0 && y >= 0 &&
            x < Number(state.map_width || 0) &&
            y < Number(state.map_height || 0);
    }

    function routeStep(state, target, blockedPositions) {
        const start = state.player_pos || [0, 0];
        if (start[0] === target[0] && start[1] === target[1]) return null;

        const targetKey = positionKey(target[0], target[1]);
        const blocked = new Set(blockedPositions || []);
        blocked.delete(targetKey);

        const queue = [{ x: start[0], y: start[1], firstDirection: '' }];
        const visited = new Set([positionKey(start[0], start[1])]);

        while (queue.length) {
            const current = queue.shift();
            const neighbours = DIRECTIONS.map(direction => ({
                direction,
                x: current.x + direction.dx,
                y: current.y + direction.dy
            })).filter(next => isInside(state, next.x, next.y));

            neighbours.sort((left, right) => {
                const leftDistance = distance([left.x, left.y], target);
                const rightDistance = distance([right.x, right.y], target);
                if (leftDistance !== rightDistance) return leftDistance - rightDistance;

                const explored = state.explored || [];
                const leftExplored = Boolean(explored[left.y] && explored[left.y][left.x]);
                const rightExplored = Boolean(explored[right.y] && explored[right.y][right.x]);
                return Number(leftExplored) - Number(rightExplored);
            });

            for (const next of neighbours) {
                const key = positionKey(next.x, next.y);
                if (visited.has(key) || blocked.has(key)) continue;

                const firstDirection = current.firstDirection || next.direction.name;
                if (key === targetKey) return firstDirection;

                visited.add(key);
                queue.push({ x: next.x, y: next.y, firstDirection });
            }
        }

        return null;
    }

    function activeEnemies(state) {
        const defeatedPositions = new Set((state.defeated_enemies || []).map(enemy => {
            return positionKey(enemy.x, enemy.y);
        }));
        return (state.enemies || []).filter(enemy => {
            return !enemy.is_defeated && !defeatedPositions.has(positionKey(enemy.x, enemy.y));
        });
    }

    function moveToward(state, target, phase, targetName, avoidEnemies = true) {
        const targetPosition = entityPosition(target);
        const blocked = avoidEnemies
            ? activeEnemies(state).map(enemy => positionKey(enemy.x, enemy.y))
            : [];
        let direction = routeStep(state, targetPosition, blocked);
        if (!direction) direction = routeStep(state, targetPosition, []);

        if (!direction) {
            const nudge = DIRECTIONS.find(candidate => {
                const x = state.player_pos[0] + candidate.dx;
                const y = state.player_pos[1] + candidate.dy;
                return isInside(state, x, y);
            });
            direction = nudge ? nudge.name : null;
        }

        if (!direction) return null;
        return {
            action: 'move',
            direction,
            phase,
            targetName: targetName || target.name || target.title || ''
        };
    }

    function choiceScore(choice, playerHp) {
        const effect = choice && typeof choice.effect === 'object' ? choice.effect : {};
        const health = Number(effect.health || 0);
        const xp = Number(effect.xp || 0);
        let score = xp;

        score += health >= 0 ? health * 1.5 : health * 3;
        if (effect.item_id) score += 18;
        if (effect.combat_enemy_id) score -= 16;
        if (health < 0 && Math.abs(health) >= playerHp) score -= 1000;
        return score;
    }

    function bestStoryChoice(state) {
        const story = state.current_story || {};
        const choices = Array.isArray(story.choices) ? story.choices : [];
        return choices.slice().sort((left, right) => {
            return choiceScore(right, state.player_hp) - choiceScore(left, state.player_hp);
        })[0] || null;
    }

    function equipmentBonus(item) {
        if (!item || !item.effect) return 0;
        return Number(item.effect[item.type === 'weapon' ? 'attack' : 'defense'] || 0);
    }

    function bestEquipmentUpgrade(state) {
        const equipment = state.equipment || {};
        const candidates = (state.inventory || []).filter(item => {
            if (!['weapon', 'armor'].includes(item.type) || item.is_equipped) return false;
            return equipmentBonus(item) > equipmentBonus(equipment[item.type]);
        });
        return candidates.sort((left, right) => equipmentBonus(right) - equipmentBonus(left))[0] || null;
    }

    function healingItem(state) {
        if (!state.player_max_hp || state.player_hp / state.player_max_hp > 0.62) return null;
        return (state.inventory || []).filter(item => {
            return item.type === 'consumable' && item.effect && Number(item.effect.health || 0) > 0;
        }).sort((left, right) => {
            return Number(right.effect.health) - Number(left.effect.health);
        })[0] || null;
    }

    function unseenRegionTarget(state, regionsSeen) {
        if (!Array.isArray(state.region_ids) || !Array.isArray(state.regions)) return null;
        if (state.regions.length < 2 || regionsSeen.length >= Math.min(2, state.regions.length)) return null;

        const seen = new Set(regionsSeen);
        const candidates = [];
        state.region_ids.forEach((row, y) => {
            row.forEach((regionId, x) => {
                if (regionId && !seen.has(regionId)) {
                    const region = state.regions.find(candidate => candidate.id === regionId);
                    candidates.push({ x, y, name: region ? region.name : '' });
                }
            });
        });
        return nearestEntity(state, candidates);
    }

    function unexploredTarget(state) {
        const candidates = [];
        (state.explored || []).forEach((row, y) => {
            row.forEach((isExplored, x) => {
                if (!isExplored) candidates.push({ x, y, name: '' });
            });
        });
        return nearestEntity(state, candidates);
    }

    function nextAction(state, review = {}) {
        if (!state) return null;
        if (state.game_won || state.game_over) {
            return { action: 'done', phase: 'finish' };
        }

        if (review.storyOutcome) {
            return { action: 'dismiss_story_outcome', phase: 'story' };
        }

        if (state.current_story && !state.in_combat) {
            const choice = bestStoryChoice(state);
            if (!choice) return { action: 'stalled', phase: 'story' };
            return {
                action: 'choose_story',
                choice_id: choice.id,
                phase: 'story',
                targetName: choice.label || ''
            };
        }

        if (state.in_combat && state.current_enemy) {
            const healing = healingItem(state);
            if (healing) {
                return {
                    action: 'use_item',
                    item_id: healing.id,
                    phase: 'combat',
                    targetName: healing.name || ''
                };
            }
            return {
                action: 'attack',
                phase: 'combat',
                targetName: state.current_enemy.name || ''
            };
        }

        const upgrade = bestEquipmentUpgrade(state);
        if (upgrade) {
            return {
                action: 'equip_item',
                item_id: upgrade.id,
                phase: 'item',
                targetName: upgrade.name || ''
            };
        }

        const uncollectedItems = (state.item_placements || []).filter(item => !item.is_collected);
        const item = nearestEntity(state, uncollectedItems);
        if (item) return moveToward(state, item, 'item', item.name, true);

        const availableStories = (state.story_placements || []).filter(story => {
            return story.status === 'available';
        });
        if (!review.moments || !review.moments.story) {
            const story = nearestEntity(state, availableStories);
            if (story) return moveToward(state, story, 'story', story.title, true);
        }

        const region = unseenRegionTarget(state, review.regionsSeen || []);
        if (region) return moveToward(state, region, 'explore', region.name, true);

        const enemy = nearestEntity(state, activeEnemies(state));
        if (enemy) return moveToward(state, enemy, 'combat', enemy.name, false);

        if (state.objective && state.objective.kind === 'stories') {
            const story = nearestEntity(state, availableStories);
            if (story) return moveToward(state, story, 'story', story.title, true);
        }

        const unexplored = unexploredTarget(state);
        if (unexplored) return moveToward(state, unexplored, 'explore', '', true);

        return { action: 'stalled', phase: 'finish' };
    }

    root.RogueLLMSpectatorPlanner = {
        activeEnemies,
        bestStoryChoice,
        nextAction,
        routeStep
    };
})(typeof window !== 'undefined' ? window : globalThis);
