require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');
const path = require('path'); // NOVA BIBLIOTECA: Ajuda a encontrar as pastas do computador

const app = express();
app.use(cors()); 
app.use(express.json());

// 👉 A MÁGICA ACONTECE AQUI: Dizemos ao servidor para exibir o seu Frontend
app.use(express.static(path.join(__dirname, 'public')));

// Configuração do Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuração do Multer (recebe a imagem e guarda na memória)
const upload = multer({ storage: multer.memoryStorage() });

// ROTA 1: Listar as promoções ativas
app.get('/api/promocoes', async (req, res) => {
    const { data, error } = await supabase
        .from('promocoes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ erro: error.message });
    res.json(data);
});

// ROTA 2: Cadastrar nova promoção com imagem
app.post('/api/promocoes', upload.single('imagem'), async (req, res) => {
    try {
        const { titulo, descricao, link_destino, ativa } = req.body;
        const imagem = req.file;

        if (!imagem) {
            return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });
        }

        // Processar a imagem com Sharp (Corta para 16:9 como você pediu no HTML)
        const imagemProcessada = await sharp(imagem.buffer)
            .resize(800, 450, { fit: 'cover' }) // Mudei para 800x450 para respeitar sua nova proporção 16:9
            .webp({ quality: 80 })
            .toBuffer();

        const nomeArquivo = `${Date.now()}-${Math.round(Math.random() * 1E9)}.webp`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('imagens-promocoes')
            .upload(nomeArquivo, imagemProcessada, {
                contentType: 'image/webp',
                upsert: false
            });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
            .from('imagens-promocoes')
            .getPublicUrl(nomeArquivo);

        const urlImagemPublica = publicUrlData.publicUrl;

        const { data: dbData, error: dbError } = await supabase
            .from('promocoes')
            .insert([
                {
                    titulo,
                    descricao,
                    link_destino,
                    url_imagem: urlImagemPublica,
                    ativa: ativa === 'true' || ativa === true
                }
            ])
            .select();

        if (dbError) throw dbError;

        res.status(201).json({ mensagem: 'Promoção cadastrada com sucesso!', dados: dbData });

    } catch (erro) {
        console.error(erro);
        res.status(500).json({ erro: 'Erro ao processar a promoção.', detalhe: erro.message });
    }
});

// ROTA 3: Excluir uma promoção
app.delete('/api/promocoes/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const { data: promo } = await supabase.from('promocoes').select('url_imagem').eq('id', id).single();
        
        if (promo && promo.url_imagem) {
            const nomeArquivo = promo.url_imagem.split('/').pop();
            await supabase.storage.from('imagens-promocoes').remove([nomeArquivo]);
        }

        const { error } = await supabase.from('promocoes').delete().eq('id', id);
        
        if (error) throw error;
        res.json({ mensagem: 'Promoção excluída com sucesso!' });
    } catch (erro) {
        res.status(500).json({ erro: 'Erro ao excluir promoção.' });
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});