
class Lobby {

    clientPlayerId;


    players = [];

    tableCards = [];

    currRound = 0;

    startRound() {

        this.currRound++;

        

    }
    
}

class Player {

    id;

    handCards = [];

}



class HandEvaluator {

    // sorted from lowest to highest
    sequences = ['HighCard', 'Pair', 'TwoPair', 'ThreeOfAKind', 'Straight', 'Flush', 'FullHouse', 'FourOfAKind', 'StraightFlush', 'RoyalFlush'];

    evaluateHands(players, tableCards) {

        let highestPlayerSequences = [];

        // run on all players
        players.forEach(player => {

            // check combined cards (table cards + player hand)
            const cards = [...tableCards, ...player.handCards];


            // find highest sequence player holds
            // (don't check high card as that's a default case)

            let highestFoundSequence = 0;

            for (let i = (this.sequences.length - 1); i > 0; i--) {

                const sequence = this.sequences[i];

                const didFindSequence = this['check' + sequence](cards);

                if (didFindSequence) {

                    highestFoundSequence = i;

                    break;

                }

            }

            // add highest sequence found in player hand
            highestPlayerSequences.push({
                playerId: player.id,
                highestFoundSequence: highestFoundSequence
            });

        });


        // sort player sequence array from highest to lowest
        highestPlayerSequences = highestPlayerSequences.sort(function(a, b) {
            return b.highestFoundSequence - a.highestFoundSequence;
        });

        // check high card default case

        const highestFoundPlayerSequence = highestPlayerSequences[0].highestFoundSequence;

        let playersWithDuplicateSequences = [];

        // skip most valuable player
        for (let i = 1; i < highestPlayerSequences.length; i++) {

            const currPlayerSeq = highestPlayerSequences[i];

            if (highestFoundPlayerSequence === currPlayerSeq.highestFoundSequence) {

                playersWithDuplicateSequences.push(currPlayerSeq);

            } else {

                break;

            }

        }


        // if multiple players hold the highest sequence
        if (playersWithDuplicateSequences.length !== 0) {

            // add player with highest sequence to array
            playersWithDuplicateSequences.unshift(highestPlayerSequences[0]);

            playersWithDuplicateSequences.forEach(sequence => {

                Math.max()

            });

        } else {

            // return player with highest sequence
            return highestPlayerSequences[0];

        }
        
    }

    checkRoyalFlush(cards) {



    }

}


// note: ace is also 1
const cardMap = {
    11: 'jack',
    12: 'queen',
    13: 'king',
    14: 'ace'
};
