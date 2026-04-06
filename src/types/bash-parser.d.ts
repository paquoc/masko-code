declare module "bash-parser" {
  interface ASTNode {
    type: string;
    commands?: ASTNode[];
    left?: ASTNode;
    right?: ASTNode;
    op?: string;
    list?: ASTNode;
    clause?: ASTNode;
    then?: ASTNode;
    else?: ASTNode;
    name?: { text: string; type: string };
    suffix?: Array<{ text: string; type: string }>;
    redirects?: Array<{ op: string; file?: { text: string } }>;
  }

  function parse(source: string): ASTNode;
  export default parse;
}
