import _ from 'lodash';
import './App.css';
import { tiles, initial } from './Const';
import React from 'react';
import { useState, useEffect } from 'react';
import { compact } from 'fp-ts/lib/Array';
import { pipe } from 'fp-ts/function';
import * as O from 'fp-ts/Option';

const AI = 1;

const COLORS = {"1": "is-black", "-1": "is-white"};

const MOVES = _.range(tiles.length);

class Data {
    board: Array<number>;
    side: number = 0;

    constructor(board: Array<number>, side: number) {
        this.board = board;
        this.side = side;

        this.count = this.count.bind(this);
        this.filterFlips = this.filterFlips.bind(this);
        this.canPlayMove = this.canPlayMove.bind(this);
        this.canPlay = this.canPlay.bind(this);
        this.fromMove = this.fromMove.bind(this);
    }

    count(side: number) {
        return this.board.filter(e => e === side).length;
    }

    winner() {
        return this.count(1) >= this.count(-1) ? 1 : -1;
    }

    filterFlips(l: Array<number>) {
        const s = _.takeWhile(l, i => this.board[i] === -this.side);
        return this.board[l[s.length]] ? s : [];
    }

    canPlayMove(i: number)  {
        return !this.board[i] && tiles[i].some(l => this.filterFlips(l).length > 0);
    }

    canPlay() {
        return MOVES.some(this.canPlayMove);
    }

    fromMove(move: number): O.Option<Data> {
        if (this.board[move]) return O.none;
        let board = _.cloneDeep(this.board);
        const ls = tiles[move].map(this.filterFlips).filter(l => l.length);
        if (!ls.length) return O.none;
        for (const l of ls) {
            board[move] = this.side;
            for (const i of l) {
                if (!board[i]) break;
                board[i] = this.side;
            }
        }
        for (const side of [-this.side, this.side]) {
            const _data = new Data(board, side);
            if (_data.canPlay()) return O.some(_data);
        }
        return O.some(new Data(board, 0));
    }

    allStates = (): Array<Data> => compact(MOVES.map(this.fromMove));
}

class UCTNode {
    chinfo: O.Option<[Array<UCTNode>, number]> = O.none;
    parent: O.Option<UCTNode> = O.none; 
    _data: Data;
    visits = 0;
    wins = 0;

    constructor(data: Data, parent: O.Option<UCTNode>) {
        this._data = _.cloneDeep(data);
        this.parent = parent;

        this.value = this.value.bind(this);
        this.selexp = this.selexp.bind(this);
        this.rollout = this.rollout.bind(this);
        this.update = this.update.bind(this);
        this.backprog = this.backprog.bind(this);
    }

    best = () => pipe(
        this.chinfo,
        O.chain(([children, cnt]) =>
            O.fromNullable(_.maxBy(children, c => {
                if (!c.visits) return 0;
                const avg = c.wins / c.visits;
                return !c._data.side ? c._data.winner() === AI
                    : (c._data.side === AI ? avg : 1 - avg);
            }))
        )
    );
            
    value() {
        if (!this.visits) return Infinity;
        const N = pipe(
            this.parent,
            O.map(node => node.visits),
            O.getOrElse(() => 1)
        );
        return this.wins / this.visits
            + Math.sqrt(2 * Math.log(N) / this.visits);
    }

    can_explore = () => this._data.side && pipe(
        this.chinfo,
        O.map(([children, cnt]) => cnt > 0),
        O.getOrElse(() => true)
    );

    selexp = (): O.Option<UCTNode> => pipe(
        this.chinfo,
        O.chain(([children, cnt]) => {
            const pos = children.filter(c => c.can_explore());
            return pipe(
                _.maxBy(pos, c => c.value()),
                O.fromNullable,
                O.chain(node => node.selexp()),
            );
        }), // guaranteed isNone
        O.alt(() => {
            const children = this._data.allStates()
                .map(e => new UCTNode(e, O.some(this)));
            const eligible = children.filter(e => e._data.side);
            this.chinfo = O.some([children, eligible.length]);
            return O.fromNullable(_.sample(eligible));
        }), // null if no children
        O.alt(() => pipe(
            this.parent,
            O.chain(node => {
                node.update();
                return node.selexp();
            })
        ))  // null at root
    );

    rollout() {
        let sim = _.cloneDeep(this._data);
        while (true) {
            const t = _.sample(sim.allStates())
                ?? new Data(sim.board, 0);
            if (!t.side) return t.winner();
            sim = t;
        }
    }

    backprog(s: number) {
        ++this.visits;
        if (s === this._data.side) ++this.wins;
        pipe(this.parent, O.map(node => node.backprog(s)));
    }

    update = () => {
        const chinfo_ = O.toNullable(this.chinfo);
        if (!chinfo_) return;
        const [children, cnt] = chinfo_;
        const cnt_ = cnt - 1;
        this.chinfo = O.some([children, cnt_]);
        if (!cnt_) {
            const p = O.toNullable(this.parent);
            p?.update();
        }
    }
}

interface PropsHeader { children?: string; }
function Header({ children = "Copyright @ 2020 Marcus Xu" }: PropsHeader) {
    return (
        <div className="header">
            <h1>Othello</h1>
            <p>{ children }</p>
        </div>
    );
}

interface PropsBoard { data: Data; handleClick: any; }
function Board({ data, handleClick }: PropsBoard): any {
    return data.board.map((e, i) => {
        if (e) {
            const className = `circle ${COLORS[e as 1|-1]}`;
            return (
                <div className="box">
                    <div className={className}></div>
                </div>
            );
        } else if (data.canPlayMove(i)) {
            const onClick = () => handleClick(i);
            return (
                <div className="box">
                    <div className="circle is-empty" onClick={onClick}></div>
                </div>
            );
        } else {
            return <div className="box"></div>;
        }
    });
}

interface PropsCounter { data: Data; side: number; }
function Counter({ data, side }: PropsCounter) {
    const className = `counter ${COLORS[side as 1|-1]}`;
    return (
        <div className={className}>
            <h1>{ data.count(side) }</h1>
        </div>
    );
}

const App = () => {
    const [data, setData] = useState(new Data(initial, 1));
    const [stat, setStat] = useState({ wins: 0, visits: 0 });
    const info = stat.visits
        ? `Win rate: ${ Math.round(stat.wins / stat.visits * 100) }%` : undefined;
    const handleClick = (e: number) => pipe(
        data.fromMove(e), O.map(data => setData(data)));
    const mcts = () => {
        if (data.side !== AI) return O.none;
        let root = new UCTNode(data, O.none);
        const start = new Date();
        while ((new Date()).getTime() - start.getTime() < 3000) {
            for (let i = 0; i < 50; ++i) {
                if (!root.can_explore()) return root.best();
                const node = O.toNullable(root.selexp());
                if (node) node.backprog(node.rollout());
            }
        }
        setStat({ wins: root.wins, visits: root.visits });
        return root.best();
    }
    useEffect(() => {
        const bdata = O.toNullable(mcts())?._data;
        if (bdata) setData(bdata);
    }, [data]);
    return (
        <div className="container">
            <Header>{ info }</Header>
            <Board data={data} handleClick={handleClick}/>
            <Counter data={data} side={ 1}/>
            <Counter data={data} side={-1}/>
        </div>
    );
};

export default App;
